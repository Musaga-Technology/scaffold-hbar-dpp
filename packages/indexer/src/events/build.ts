/**
 * Building passport events for submission to HCS.
 */
import { canonicalize, hashPayload } from "./canonical.js";
import { EVENT_VERSION, MAX_EVENT_BYTES, type EventType, type PassportEvent } from "./types.js";

/** Fields the caller supplies; the rest are derived. */
export interface BuildEventInput {
  type: EventType;
  serial: number;
  tokenId: string;
  actor: string;
  payload: Record<string, unknown>;
  ref?: string;
  prev?: number;
  sig?: string;
  actorDid?: string;
  /** Defaults to now. Injected in tests so output is deterministic. */
  ts?: Date;
}

/** Payload keys that habitually carry embedded blobs. */
const BLOB_PRONE_KEYS = [
  "data",
  "file",
  "image",
  "document",
  "attachment",
  "photo",
  "scan",
  "certificate",
  "cert",
  "report",
  "blob",
  "content",
  "body",
];

/** A string this long under a blob-prone key is content, not a reference. */
const BLOB_KEY_MAX_LENGTH = 256;

/**
 * A string this long under ANY key is content.
 *
 * Field-name heuristics leak — the next person calls it `coa` or `spec_sheet` —
 * so there is also a rule that does not care what the field is called. The whole
 * message is capped at 1024 bytes anyway; this exists to fail with a message
 * that says what is actually wrong instead of "message too big".
 */
const ANY_VALUE_MAX_LENGTH = 512;

/**
 * Rejects payloads that try to put content on HCS instead of a reference to it.
 *
 * A topic is a log. Embedding a certificate or a photo makes every future reader
 * pay to replay it, and this template refuses rather than letting the
 * anti-pattern in quietly.
 *
 * @param payload Payload to check.
 * @throws When a payload field looks like embedded content.
 */
export function assertNoEmbeddedContent(payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string") continue;

    const lowerKey = key.toLowerCase();
    const looksLikeBlobKey = BLOB_PRONE_KEYS.some(blobKey => lowerKey === blobKey || lowerKey.endsWith(blobKey));

    if (value.startsWith("data:")) {
      throw new Error(
        `payload.${key} is a data URI. Store the content off-chain and reference it with a URL plus a sha256 hash.`,
      );
    }
    const limit = looksLikeBlobKey ? BLOB_KEY_MAX_LENGTH : ANY_VALUE_MAX_LENGTH;
    if (value.length > limit) {
      throw new Error(
        `payload.${key} is ${value.length} characters — too long to be a reference. ` +
          "Store the content off-chain and put its URL and sha256 hash here instead.",
      );
    }
  }
}

/**
 * Builds a validated, hash-anchored event ready for submission.
 *
 * @param input Event fields.
 * @returns The event and the exact message text to submit.
 * @throws When the payload embeds content, or the message exceeds the HCS cap.
 */
export function buildEvent(input: BuildEventInput): { event: PassportEvent; message: string } {
  assertNoEmbeddedContent(input.payload);

  const event: PassportEvent = {
    v: EVENT_VERSION,
    type: input.type,
    serial: input.serial,
    tokenId: input.tokenId,
    ts: (input.ts ?? new Date()).toISOString(),
    actor: input.actor,
    payloadHash: hashPayload(input.payload),
    payload: input.payload,
    ...(input.ref === undefined ? {} : { ref: input.ref }),
    ...(input.prev === undefined ? {} : { prev: input.prev }),
    ...(input.sig === undefined ? {} : { sig: input.sig }),
    ...(input.actorDid === undefined ? {} : { actorDid: input.actorDid }),
  };

  const message = canonicalize(event);
  const bytes = Buffer.byteLength(message, "utf8");
  if (bytes > MAX_EVENT_BYTES) {
    throw new Error(
      `Event is ${bytes} bytes, over the ${MAX_EVENT_BYTES}-byte limit. ` +
        "Move large content off HCS and reference it by hash and URL instead.",
    );
  }

  return { event, message };
}
