/**
 * Content addressing, done properly.
 *
 * A CID is only a proof if somebody checks it. Hashing whatever a gateway
 * returns proves the bytes match a digest, but it trusts the gateway to have
 * fetched the right thing — and at that point the CID is just a URL with extra
 * steps. Swap `ipfs.io` for an S3 bucket and nothing would change.
 *
 * This module is what makes IPFS load-bearing rather than decorative:
 *
 *   - `computeCid` derives a document's address from its bytes, locally, so the
 *     address the passport commits to never depends on what a pinning service
 *     says it is.
 *   - `readVerifiedCar` takes a CAR file from any gateway, however untrusted,
 *     checks every block against its own hash, and rebuilds the document from
 *     blocks that passed. A gateway that serves the wrong bytes is caught at the
 *     block level and cannot produce a verified document.
 *
 * With a URL, you have to trust the server. With a CID checked like this, you
 * do not have to trust anybody — which is the property a passport needs, since
 * the party most motivated to swap a certificate is often the one hosting it.
 *
 * No Node imports, so the app can use `computeCid` too.
 */
import { CarBlockIterator, CarWriter } from "@ipld/car";
import { exporter } from "ipfs-unixfs-exporter";
import { importBytes, type ImporterOptions } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { CID } from "multiformats/cid";
import { identity } from "multiformats/hashes/identity";
import { sha256 } from "multiformats/hashes/sha2";

/** Chunk size for documents: 256 KiB. */
export const CHUNK_BYTES = 256 * 1024;

/**
 * How documents are chunked into a DAG, and therefore what CID they get.
 *
 * CIDv1, raw leaves, 256 KiB chunks, sha2-256, balanced layout with 174 links
 * per node — what `ipfs add --cid-version=1` produces, and what Pinata documents
 * as its default. Matching it is what lets the upload route compute a
 * document's CID itself and refuse a provider that reports a different one,
 * without needing the paid-plan CAR upload that would otherwise fix the address.
 *
 * A document up to 256 KiB becomes a single raw block, so its CID is literally
 * the sha256 of its bytes: the CID and the digest committed on HCS are the same
 * hash in two encodings.
 *
 * Verification does not depend on this. `readVerifiedCar` checks any DAG under
 * any layout; only `computeCid` has to agree with whoever pinned the document.
 */
const IMPORT_OPTIONS: ImporterOptions = {
  cidVersion: 1,
  rawLeaves: true,
  reduceSingleLeafToSelf: true,
  chunker: fixedSize({ chunkSize: CHUNK_BYTES }),
  layout: balanced({ maxChildrenPerNode: 174 }),
};

/**
 * Gateways the indexer verifies through by default, tried in order.
 *
 * Two independent operators, both serving the trustless-gateway spec (checked
 * September 2026). Neither is trusted — a gateway that lies is caught at the
 * block level — so a second one is pure availability, never a second opinion.
 * `ipfs.io` and `dweb.link` redirect to the first, so listing them adds nothing.
 */
export const DEFAULT_IPFS_VERIFY_GATEWAYS = ["https://trustless-gateway.link", "https://gateway.pinata.cloud"] as const;

/** Media type for CAR responses from a trustless gateway. */
export const CAR_MEDIA_TYPE = "application/vnd.ipld.car";

/** Why a CAR could not be turned into a verified document. */
export type CarFailure =
  /** A block's bytes do not hash to its CID. Whoever served it altered it. */
  | "tampered-block"
  /** The CAR is rooted somewhere other than the CID that was asked for. */
  | "wrong-root"
  /** The CAR does not contain every block the document needs. */
  | "incomplete"
  /** The CID uses a hash function this verifier does not implement. */
  | "unsupported-hash"
  /** The CID names a directory or other non-file DAG, not one document. */
  | "not-a-file"
  /** The bytes are not a readable CAR at all. */
  | "malformed";

/** A CAR that did not yield a verified document. */
export class CarVerificationError extends Error {
  constructor(
    readonly reason: CarFailure,
    message: string,
  ) {
    super(message);
    this.name = "CarVerificationError";
  }
}

/** In-memory block store keyed so CIDv0 and CIDv1 of the same block agree. */
class MemoryBlocks {
  private readonly blocks = new Map<string, Uint8Array>();

  private static key(cid: CID): string {
    return CID.createV1(cid.code, cid.multihash).toString();
  }

  set(cid: CID, bytes: Uint8Array): void {
    this.blocks.set(MemoryBlocks.key(cid), bytes);
  }

  has(cid: CID): boolean {
    return this.blocks.has(MemoryBlocks.key(cid));
  }

  entries(): IterableIterator<[string, Uint8Array]> {
    return this.blocks.entries();
  }

  // The shapes the UnixFS importer and exporter expect of a blockstore.
  readonly put = async (cid: CID, value: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>) => {
    this.set(cid, value instanceof Uint8Array ? value : await concat(value));
    return cid;
  };

  readonly get = (cid: CID) => {
    const bytes = this.blocks.get(MemoryBlocks.key(cid));
    return (async function* () {
      if (!bytes) {
        throw new CarVerificationError("incomplete", `The CAR is missing block ${cid.toString()}.`);
      }
      yield bytes;
    })();
  };
}

async function concat(chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    length += chunk.byteLength;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Checks one block against its CID.
 *
 * @throws CarVerificationError when the bytes do not hash to the CID, or the
 *   CID uses a hash function this verifier cannot check.
 */
async function checkBlock(cid: CID, bytes: Uint8Array): Promise<void> {
  const { code, digest } = cid.multihash;

  let actual: Uint8Array;
  if (code === sha256.code) {
    actual = (await sha256.digest(bytes)).digest;
  } else if (code === identity.code) {
    actual = bytes;
  } else {
    // Refusing is the honest answer. Accepting a block we could not check
    // would put an unverified document behind a verified badge.
    throw new CarVerificationError(
      "unsupported-hash",
      `Block ${cid.toString()} uses multihash 0x${code.toString(16)}, which this verifier does not implement.`,
    );
  }

  if (!sameBytes(actual, digest)) {
    throw new CarVerificationError(
      "tampered-block",
      `Block ${cid.toString()} does not hash to its own CID. The gateway served altered content.`,
    );
  }
}

/**
 * Parses a CID, returning null rather than throwing on malformed input.
 *
 * @param value Candidate CID string.
 * @returns The parsed CID, or null.
 */
export function parseCid(value: string): CID | null {
  try {
    return CID.parse(value);
  } catch {
    return null;
  }
}

/**
 * Computes the CID a document gets when pinned with the settings above.
 *
 * Deterministic and offline: no pinning service is consulted, so the address
 * a passport commits to is derived from the document itself.
 *
 * @param bytes The document.
 * @returns Its CID, as a base32 CIDv1 string.
 */
export async function computeCid(bytes: Uint8Array): Promise<string> {
  const blocks = new MemoryBlocks();
  const { cid } = await importBytes(bytes, blocks, IMPORT_OPTIONS);
  return cid.toString();
}

/**
 * Packs a document into a CAR file, chunked with the settings above.
 *
 * A CAR is the portable form of a content-addressed document: every block,
 * plus the root. Uploading a CAR to a pinning service fixes the address — the
 * service stores exactly these blocks rather than re-chunking the file and
 * possibly arriving at a different CID.
 *
 * @param bytes The document.
 * @returns Its CID and the CAR bytes.
 */
export async function buildCar(bytes: Uint8Array): Promise<{ cid: string; car: Uint8Array }> {
  const blocks = new MemoryBlocks();
  const { cid } = await importBytes(bytes, blocks, IMPORT_OPTIONS);

  const { writer, out } = CarWriter.create([cid]);
  const collected = concat(out);
  for (const [key, block] of blocks.entries()) {
    await writer.put({ cid: CID.parse(key), bytes: block });
  }
  await writer.close();

  return { cid: cid.toString(), car: await collected };
}

/**
 * Rebuilds a document from a CAR, trusting nothing about where the CAR came from.
 *
 * Every block is hashed and compared against its CID before it is used, the CAR
 * must be rooted at the CID that was asked for, and the document is assembled
 * only from blocks that passed. If this returns, the bytes are exactly the
 * content that `expectedCid` names — regardless of which gateway served them.
 *
 * @param car CAR bytes, as served by a trustless gateway.
 * @param expectedCid The CID the passport committed to.
 * @returns The document's bytes.
 * @throws CarVerificationError describing precisely what failed.
 */
export async function readVerifiedCar(car: Uint8Array, expectedCid: string): Promise<Uint8Array> {
  const expected = parseCid(expectedCid);
  if (!expected) {
    throw new CarVerificationError("malformed", `${expectedCid} is not a valid CID.`);
  }

  let iterator: CarBlockIterator;
  try {
    iterator = await CarBlockIterator.fromBytes(car);
  } catch (error) {
    throw new CarVerificationError(
      "malformed",
      `The response is not a readable CAR: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const blocks = new MemoryBlocks();
  try {
    for await (const { cid, bytes } of iterator) {
      await checkBlock(cid, bytes);
      blocks.set(cid, bytes);
    }
  } catch (error) {
    if (error instanceof CarVerificationError) throw error;
    throw new CarVerificationError(
      "malformed",
      `The CAR could not be read to the end: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Roots are advisory in a CAR — what matters is that the block we start from
  // is the one we asked for, and that it passed its hash check above.
  if (!blocks.has(expected)) {
    const roots = await iterator.getRoots();
    const rootedHere = roots.some(root => sameBytes(root.multihash.bytes, expected.multihash.bytes));
    throw new CarVerificationError(
      rootedHere ? "incomplete" : "wrong-root",
      `The CAR does not contain ${expectedCid}` +
        (rootedHere ? "." : ` — it is rooted at ${roots.map(String).join(", ") || "nothing"}.`),
    );
  }

  let entry;
  try {
    entry = await exporter(expected, blocks);
  } catch (error) {
    if (error instanceof CarVerificationError) throw error;
    throw new CarVerificationError(
      "malformed",
      `The DAG under ${expectedCid} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (entry.type !== "file" && entry.type !== "raw" && entry.type !== "identity") {
    throw new CarVerificationError(
      "not-a-file",
      `${expectedCid} is a ${entry.type}, not a single document. A passport attachment must name one file.`,
    );
  }

  try {
    return await concat(entry.content());
  } catch (error) {
    if (error instanceof CarVerificationError) throw error;
    throw new CarVerificationError(
      "incomplete",
      `The document under ${expectedCid} could not be assembled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Builds the trustless-gateway URL for a CID's CAR.
 *
 * `dag-scope=entity` asks for exactly the blocks needed to rebuild the file and
 * nothing more — the spec'd way to fetch one document verifiably.
 *
 * @param cid The document's CID.
 * @param gateway Gateway base URL.
 * @returns The URL to fetch.
 */
export function carUrl(cid: string, gateway: string): string {
  return `${gateway.replace(/\/+$/, "")}/ipfs/${cid}?format=car&dag-scope=entity`;
}
