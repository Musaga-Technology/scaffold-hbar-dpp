/**
 * Attachment verification.
 *
 * Pinning a document to IPFS is easy and almost nobody checks it afterwards.
 * This is the part that makes the storage integration worth anything: for every
 * document a passport references, fetch it back, hash what actually arrives, and
 * compare against the hash the event committed to.
 *
 * Four outcomes, and the distinction between the last two matters:
 *
 *   verified     the bytes hash to what the event declared
 *   mismatch     something is at that address, but not what was attested
 *   unreachable  nothing answered — the reference may be sound but is unusable
 *   pending      not checked yet
 *
 * `mismatch` is the serious one: it means a certificate was swapped after the
 * fact. `unreachable` is a weaker finding, and often temporary — a gateway
 * hiccup is not evidence of fraud, and calling it one would be its own kind of
 * dishonesty. They are reported separately for that reason.
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
  DEFAULT_ARWEAVE_GATEWAY,
  DEFAULT_IPFS_GATEWAY,
  gatewayUrl,
  readAttachments,
  type AttachmentProtocol,
  type EventAttachment,
} from "./events/index.js";
import type { AttachmentVerdict, IndexStore } from "./store/index.js";

/** Largest document the indexer will pull down while verifying. */
export const MAX_VERIFY_BYTES = 25 * 1024 * 1024;

/** How long a single fetch may take before it is treated as unreachable. */
export const FETCH_TIMEOUT_MS = 20_000;

/** Minimal fetch surface, so tests can supply one that never touches a network. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
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
  ipfs: string;
  arweave: string;
}

/** Gateway defaults, used when nothing is configured. */
export const DEFAULT_GATEWAYS: Gateways = {
  ipfs: DEFAULT_IPFS_GATEWAY,
  arweave: DEFAULT_ARWEAVE_GATEWAY,
};

/**
 * Fetches one attachment and judges it.
 *
 * Never throws: a verification pass that died on one bad gateway response would
 * leave every later attachment unchecked.
 *
 * @param attachment The reference to check.
 * @param gateway IPFS gateway base URL.
 * @param fetchImpl Injected for tests.
 * @returns The verdict, without the identifying keys.
 */
export async function verifyAttachment(
  attachment: { cid: string; declaredHash: string; protocol?: AttachmentProtocol },
  gateways: Gateways = DEFAULT_GATEWAYS,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Omit<AttachmentVerdict, "topicId" | "sequenceNumber" | "cid">> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const protocol = attachment.protocol ?? "ipfs";
  const gateway = protocol === "arweave" ? gateways.arweave : gateways.ipfs;

  try {
    // Verification is identical whichever network the document lives on: fetch
    // it back and compare the hash. Only the URL shape differs.
    const response = await fetchImpl(gatewayUrl(attachment.cid, gateway, protocol), {
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        state: "unreachable",
        note: `Gateway returned ${response.status} ${response.statusText}. The content may still exist; it could not be read here.`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > MAX_VERIFY_BYTES) {
      return {
        state: "unreachable",
        bytes: buffer.byteLength,
        note: `Document is ${buffer.byteLength} bytes, over the ${MAX_VERIFY_BYTES}-byte verification limit. Not checked.`,
      };
    }

    const observedHash = createHash("sha256").update(buffer).digest("hex");

    if (observedHash === attachment.declaredHash) {
      return { state: "verified", observedHash, bytes: buffer.byteLength };
    }

    return {
      state: "mismatch",
      observedHash,
      bytes: buffer.byteLength,
      note:
        `The document at this address does not match the hash committed on HCS. ` +
        `Declared ${attachment.declaredHash.slice(0, 16)}…, found ${observedHash.slice(0, 16)}…. ` +
        `It has been replaced since it was attested.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      state: "unreachable",
      note: `Could not fetch the document: ${reason}. This is not evidence the content is wrong, only that it could not be read.`,
    };
  } finally {
    clearTimeout(timeout);
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
 * @param gateway IPFS gateway base URL.
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
