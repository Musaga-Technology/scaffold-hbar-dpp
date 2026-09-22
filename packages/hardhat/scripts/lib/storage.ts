/**
 * Pinning for the bootstrap script.
 *
 * The app has its own provider abstraction in `packages/nextjs/services/storage`,
 * and this does not try to share it: that module is Next.js server-only code,
 * and the two workspaces are separate runtimes. What matters is that both
 * produce the *same document* — which they do, because both build it with
 * `buildHip412Metadata` — not that they share the twenty lines that POST it.
 *
 * Like the app, this computes each document's CID itself and refuses to use one
 * Pinata reports differently. The bootstrap only pins small things — a metadata
 * document and one demo certificate — so it takes the short road: under 256 KiB
 * a document is a single raw block, and its CID is just its sha256 in CID form.
 * That needs no IPFS libraries, which matters because they are ESM-only and this
 * workspace is not.
 *
 * If a second provider is ever added here, this is the place to put the seam.
 */
import { createHash } from "node:crypto";

/**
 * Pinata's v3 upload API. The legacy `pinFileToIPFS` endpoint needs a legacy
 * scope that keys created today do not carry by default.
 */
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

/** Largest document that is a single raw block — the chunk size. */
export const SINGLE_BLOCK_MAX_BYTES = 256 * 1024;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * The CIDv1 of a single-block document: raw codec, sha2-256.
 *
 * Byte layout: version 0x01, codec 0x55 (raw), multihash 0x12 (sha2-256) with
 * length 0x20, then the digest — base32-encoded with the multibase prefix `b`.
 * Matches `computeCid` in `packages/indexer/src/content/ipfs.ts` for any
 * document up to {@link SINGLE_BLOCK_MAX_BYTES}.
 *
 * @param bytes The document.
 * @returns Its CID.
 * @throws When the document is too large to be one block.
 */
export function rawCid(bytes: Uint8Array): string {
  if (bytes.byteLength > SINGLE_BLOCK_MAX_BYTES) {
    throw new Error(
      `Document is ${bytes.byteLength} bytes; the bootstrap only pins single-block documents ` +
        `(up to ${SINGLE_BLOCK_MAX_BYTES}). Upload larger ones from the issuer page.`,
    );
  }

  const digest = createHash("sha256").update(bytes).digest();
  const cid = Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest]);

  let out = "b";
  let buffer = 0;
  let bits = 0;
  for (const byte of cid) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/** True when the bootstrap can pin. */
export function canPin(): boolean {
  return Boolean(process.env.PINATA_JWT);
}

/**
 * Pins a document and returns its CID, checked against the one computed here.
 *
 * @param bytes The document.
 * @param filename Name recorded with the pin, for the operator's benefit.
 * @param type Media type.
 * @returns The CID, or undefined when no provider is configured.
 * @throws When a provider is configured but the upload fails or reports a
 *         different CID, because silently falling back would register a
 *         product whose references are not what the operator asked for.
 */
export async function pinFile(bytes: Uint8Array, filename: string, type: string): Promise<string | undefined> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return undefined;

  const cid = rawCid(bytes);

  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)], { type }), filename);
  form.append("network", "public");

  const response = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Pinata rejected the upload of ${filename}: ${response.status} ${response.statusText}. ${detail.slice(0, 200)}\n` +
        "Unset PINATA_JWT to fall back to an app-hosted metadata URL, or fix the key and re-run — " +
        "the bootstrap is idempotent and will not repeat the steps that already succeeded.",
    );
  }

  const pinned = ((await response.json()) as { data?: { cid?: string } }).data?.cid;
  if (!pinned) throw new Error(`Pinata accepted ${filename} but returned no CID.`);
  if (pinned !== cid) {
    throw new Error(
      `Pinata stored ${filename} as ${pinned}, but its bytes hash to ${cid}. ` +
        "Refusing to register an address that does not match the content.",
    );
  }

  return cid;
}

/**
 * Pins a JSON document and returns its CID.
 *
 * @param document Any JSON-serialisable value.
 * @param filename Name recorded with the pin, for the operator's benefit.
 * @returns The CID, or undefined when no provider is configured.
 */
export async function pinJson(document: unknown, filename = "metadata.json"): Promise<string | undefined> {
  return pinFile(new TextEncoder().encode(JSON.stringify(document, null, 2)), filename, "application/json");
}
