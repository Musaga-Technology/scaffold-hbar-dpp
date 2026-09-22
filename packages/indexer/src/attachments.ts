/**
 * Attachment verification.
 *
 * Pinning a document to IPFS is easy and almost nobody checks it afterwards.
 * This is the part that makes the storage integration worth anything: for every
 * document a passport references, fetch it back — from gateways that are not
 * trusted — check it against its CID, and compare its sha256 against the hash
 * the event committed to.
 *
 * Four outcomes, and the distinction between the last two matters:
 *
 *   verified     the document the reference names hashes to what was attested
 *   mismatch     the reference names a document, but not the one attested
 *   unreachable  no verifiable copy could be read — proves nothing either way
 *   pending      not checked yet
 *
 * `mismatch` is the serious one. Content behind a CID cannot change, so it does
 * not mean a certificate was swapped later — it means the issuer committed a
 * sha256 of one document and a CID of another. An attestation that contradicts
 * itself is precisely what a verifier exists to catch. `unreachable` is weaker
 * and often temporary: a gateway failing, or serving altered blocks, is not
 * evidence against the passport, and calling it one would be its own kind of
 * dishonesty.
 *
 * `unreachable` is also what pin rot looks like. IPFS content persists only
 * while somebody keeps paying to pin it, so a passport whose manufacturer
 * stopped paying degrades to exactly this state — the reference stays valid and
 * the content is gone. That failure mode is why the model also speaks Arweave,
 * which is paid once and stored by endowment.
 *
 * Note what this cannot prove: that the document says what it claims to say.
 * It proves only that the document is the one that was attested to at that
 * consensus timestamp. That is a narrow guarantee, and stating it narrowly is
 * the point.
 */
import { createHash } from "node:crypto";

import {
  CAR_MEDIA_TYPE,
  CarVerificationError,
  DEFAULT_IPFS_VERIFY_GATEWAYS,
  carUrl,
  readVerifiedCar,
} from "./content/ipfs.js";
import {
  DEFAULT_ARWEAVE_GATEWAY,
  gatewayUrl,
  readAttachments,
  type AttachmentProtocol,
  type EventAttachment,
} from "./events/index.js";
import type { AttachmentVerdict, IndexStore } from "./store/index.js";

/** Largest document the indexer will pull down while verifying. */
export const MAX_VERIFY_BYTES = 25 * 1024 * 1024;

/** Framing a CAR adds on top of the document it carries, allowed before refusing one. */
const CAR_OVERHEAD_BYTES = 1024 * 1024;

/** How long a single fetch may take before it is treated as unreachable. */
export const FETCH_TIMEOUT_MS = 20_000;

/** Minimal fetch surface, so tests can supply one that never touches a network. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

/**
 * Records the attachments an event declares, so they can be verified later.
 *
 * Called by the poller as each event is indexed. Storing the reference is
 * separate from checking it: a reference is a fact about the log and belongs in
 * the index immediately, while a verdict depends on a network round trip that
 * may fail for reasons that have nothing to do with the passport.
 *
 * @param store Index to write to.
 * @param topicId Topic carrying the event.
 * @param sequenceNumber Sequence of the event on that topic.
 * @param payload Decoded event payload.
 * @returns The references recorded.
 */
export async function recordAttachments(
  store: IndexStore,
  topicId: string,
  sequenceNumber: number,
  payload: unknown,
): Promise<EventAttachment[]> {
  const found = readAttachments(payload);

  for (const attachment of found) {
    await store.upsertAttachment({
      topicId,
      sequenceNumber,
      cid: attachment.cid,
      protocol: attachment.protocol ?? "ipfs",
      declaredHash: attachment.hash,
      name: attachment.name ?? null,
      mediaType: attachment.type ?? null,
      bytes: attachment.bytes ?? null,
    });
  }

  return found;
}

/** Gateways to read each network's content back through. */
export interface Gateways {
  /** Tried in order until one serves a CAR that checks out against the CID. */
  ipfs: readonly string[];
  arweave: string;
}

/** Gateway defaults, used when nothing is configured. */
export const DEFAULT_GATEWAYS: Gateways = {
  ipfs: DEFAULT_IPFS_VERIFY_GATEWAYS,
  arweave: DEFAULT_ARWEAVE_GATEWAY,
};

type Verdict = Omit<AttachmentVerdict, "topicId" | "sequenceNumber" | "cid">;

/** Hostname of a gateway, for notes a person will read. */
function host(gateway: string): string {
  try {
    return new URL(gateway).host;
  } catch {
    return gateway;
  }
}

/**
 * Fetches a URL with a timeout, never throwing.
 *
 * @returns The body, or a reason it could not be read.
 */
async function fetchBytes(
  url: string,
  fetchImpl: FetchLike,
  headers?: Record<string, string>,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, ...(headers ? { headers } : {}) });
    if (!response.ok) return { ok: false, reason: `returned ${response.status} ${response.statusText}` };
    return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Judges bytes that are known to be what the reference names. */
function judge(bytes: Uint8Array, declaredHash: string, verifiedBy: string): Verdict {
  const observedHash = createHash("sha256").update(bytes).digest("hex");

  if (observedHash === declaredHash) {
    return { state: "verified", observedHash, bytes: bytes.byteLength, note: verifiedBy };
  }

  return {
    state: "mismatch",
    observedHash,
    bytes: bytes.byteLength,
    note:
      `The document this reference names is not the one whose hash was committed on HCS. ` +
      `Declared ${declaredHash.slice(0, 16)}…, found ${observedHash.slice(0, 16)}…. ` +
      `The issuer attested to different content than the document they pointed at.`,
  };
}

/**
 * Verifies an IPFS document against its CID, through untrusted gateways.
 *
 * Each gateway is asked for a CAR, and every block is checked against its own
 * hash before the document is rebuilt. That changes what the verdicts mean:
 *
 *   - Once a document is rebuilt, the bytes are exactly what the CID names. No
 *     gateway could have substituted them. So a `mismatch` is never a gateway's
 *     fault — it can only mean the issuer committed a sha256 of different content
 *     than the CID they committed alongside it.
 *   - A gateway that serves altered blocks is caught, skipped, and named in the
 *     note. It never produces a verdict against the passport.
 *
 * Content behind a CID cannot change, so "the certificate was replaced later" is
 * not something IPFS allows. What this catches is the thing that can happen: an
 * attestation that does not match its own reference.
 */
async function verifyIpfs(
  cid: string,
  declaredHash: string,
  gateways: readonly string[],
  fetchImpl: FetchLike,
): Promise<Verdict> {
  const failures: string[] = [];

  for (const gateway of gateways) {
    const fetched = await fetchBytes(carUrl(cid, gateway), fetchImpl, { accept: CAR_MEDIA_TYPE });
    if (!fetched.ok) {
      failures.push(`${host(gateway)} ${fetched.reason}`);
      continue;
    }

    // A CAR carries some framing on top of the document, hence the slack.
    if (fetched.bytes.byteLength > MAX_VERIFY_BYTES + CAR_OVERHEAD_BYTES) {
      failures.push(`${host(gateway)} served ${fetched.bytes.byteLength} bytes, over the verification limit`);
      continue;
    }

    let document: Uint8Array;
    try {
      document = await readVerifiedCar(fetched.bytes, cid);
    } catch (error) {
      if (
        error instanceof CarVerificationError &&
        (error.reason === "unsupported-hash" || error.reason === "not-a-file")
      ) {
        // A property of the CID itself, so no other gateway would do better.
        return { state: "unreachable", note: `${error.message} It cannot be verified as a passport document.` };
      }
      failures.push(`${host(gateway)}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (document.byteLength > MAX_VERIFY_BYTES) {
      return {
        state: "unreachable",
        bytes: document.byteLength,
        note: `Document is ${document.byteLength} bytes, over the ${MAX_VERIFY_BYTES}-byte verification limit. Not checked.`,
      };
    }

    return judge(
      document,
      declaredHash,
      `Rebuilt from blocks each checked against the CID, served by ${host(gateway)}. No gateway was trusted.`,
    );
  }

  return {
    state: "unreachable",
    note:
      `No gateway returned a copy that could be checked against its CID (${failures.join("; ") || "none configured"}). ` +
      `This is not evidence the content is wrong, only that it could not be read.`,
  };
}

/**
 * Verifies an Arweave document by hash.
 *
 * Weaker than the IPFS path, and the note says so: an Arweave transaction id is
 * not a hash of the data, so nothing here checks that the gateway returned the
 * data belonging to that id. The sha256 committed on HCS still binds the
 * content, so a substituted document shows as a mismatch — but on this path a
 * mismatch could also be a dishonest gateway, and the note does not pretend
 * otherwise.
 */
async function verifyArweave(
  txId: string,
  declaredHash: string,
  gateway: string,
  fetchImpl: FetchLike,
): Promise<Verdict> {
  const fetched = await fetchBytes(gatewayUrl(txId, gateway, "arweave"), fetchImpl);
  if (!fetched.ok) {
    return {
      state: "unreachable",
      note: `Could not fetch the document: ${host(gateway)} ${fetched.reason}. This is not evidence the content is wrong, only that it could not be read.`,
    };
  }

  if (fetched.bytes.byteLength > MAX_VERIFY_BYTES) {
    return {
      state: "unreachable",
      bytes: fetched.bytes.byteLength,
      note: `Document is ${fetched.bytes.byteLength} bytes, over the ${MAX_VERIFY_BYTES}-byte verification limit. Not checked.`,
    };
  }

  const verdict = judge(
    fetched.bytes,
    declaredHash,
    `Hash matched the bytes served by ${host(gateway)}, which is trusted to return this transaction's data — an Arweave id is not a content hash.`,
  );
  if (verdict.state === "mismatch") {
    verdict.note += ` Arweave ids are not content hashes, so ${host(gateway)} returning the wrong data would look the same.`;
  }
  return verdict;
}

/**
 * Fetches one attachment and judges it.
 *
 * Never throws: a verification pass that died on one bad gateway response would
 * leave every later attachment unchecked.
 *
 * @param attachment The reference to check.
 * @param gateways Gateways per network.
 * @param fetchImpl Injected for tests.
 * @returns The verdict, without the identifying keys.
 */
export async function verifyAttachment(
  attachment: { cid: string; declaredHash: string; protocol?: AttachmentProtocol },
  gateways: Gateways = DEFAULT_GATEWAYS,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Verdict> {
  try {
    return attachment.protocol === "arweave"
      ? await verifyArweave(attachment.cid, attachment.declaredHash, gateways.arweave, fetchImpl)
      : await verifyIpfs(attachment.cid, attachment.declaredHash, gateways.ipfs, fetchImpl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      state: "unreachable",
      note: `Could not verify the document: ${reason}. This is not evidence the content is wrong, only that it could not be read.`,
    };
  }
}

/**
 * Verifies every attachment that has not yet been checked.
 *
 * Already-verified documents are not re-fetched: content addressing means the
 * bytes behind a CID cannot change, so a `verified` verdict stays true. A
 * `mismatch` is not rechecked either — a swapped document is a permanent fact
 * about the record. Only `unreachable` and `pending` are retried, because those
 * are the two that a working gateway can resolve.
 *
 * @param store Index to read and update.
 * @param gateways Gateways per network.
 * @param fetchImpl Injected for tests.
 * @returns Counts by outcome.
 */
export async function verifyPendingAttachments(
  store: IndexStore,
  gateways: Gateways = DEFAULT_GATEWAYS,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<{ checked: number; verified: number; mismatch: number; unreachable: number }> {
  const all = await store.listAllAttachments();
  const toCheck = all.filter(row => row.state === "pending" || row.state === "unreachable");

  const verdicts: AttachmentVerdict[] = [];
  const counts = { checked: 0, verified: 0, mismatch: 0, unreachable: 0 };

  for (const row of toCheck) {
    const outcome = await verifyAttachment(
      { cid: row.cid, declaredHash: row.declaredHash, protocol: row.protocol },
      gateways,
      fetchImpl,
    );

    verdicts.push({
      topicId: row.topicId,
      sequenceNumber: row.sequenceNumber,
      cid: row.cid,
      ...outcome,
    });

    counts.checked += 1;
    if (outcome.state === "verified") counts.verified += 1;
    if (outcome.state === "mismatch") counts.mismatch += 1;
    if (outcome.state === "unreachable") counts.unreachable += 1;
  }

  await store.recordAttachmentVerdicts(verdicts);
  return counts;
}
