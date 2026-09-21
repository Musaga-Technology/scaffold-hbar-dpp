/**
 * Decoding topic messages read from the mirror node.
 *
 * Decoding never throws and never drops. A message that cannot be understood is
 * recorded as malformed with a hash of its raw bytes, because "something
 * unreadable was written to this topic at this consensus time" is itself part of
 * a product's history, and hiding it would be the same sin as hiding a
 * discrepancy.
 */
import { hashPayload, sha256Hex } from "./canonical.js";
import {
  EVENT_VERSION,
  isBuiltInEventType,
  isKnownEventType,
  type DecodeResult,
  type MalformedEvent,
  type MalformedReason,
  type PassportEvent,
} from "./types.js";

const REQUIRED_FIELDS = ["v", "type", "serial", "tokenId", "ts", "actor", "payloadHash", "payload"] as const;

function malformed(reason: MalformedReason, detail: string, raw: string): MalformedEvent {
  return { ok: false, reason, detail, rawHash: sha256Hex(raw) };
}

/**
 * Decodes a topic message body into a passport event.
 *
 * @param raw Message text, already base64-decoded from the mirror node.
 * @returns A decoded event with its hash verdict, or a malformed record.
 */
export function decodeEvent(raw: string): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return malformed("invalid-json", "Message body is not JSON.", raw);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return malformed("not-an-object", "Message body is not a JSON object.", raw);
  }

  const candidate = parsed as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (candidate[field] === undefined) {
      return malformed("missing-required-field", `Missing required field "${field}".`, raw);
    }
  }

  if (typeof candidate.v !== "number") {
    return malformed("bad-field-type", `"v" must be a number.`, raw);
  }
  if (candidate.v !== EVENT_VERSION) {
    return malformed(
      "unsupported-version",
      `Event schema version ${candidate.v} is not supported (expected ${EVENT_VERSION}).`,
      raw,
    );
  }
  if (typeof candidate.type !== "string" || !isKnownEventType(candidate.type)) {
    return malformed("bad-field-type", `"type" is not an accepted event type: ${String(candidate.type)}.`, raw);
  }
  if (typeof candidate.serial !== "number" || !Number.isInteger(candidate.serial) || candidate.serial < 1) {
    return malformed("bad-field-type", `"serial" must be a positive integer.`, raw);
  }
  if (typeof candidate.tokenId !== "string" || !/^\d+\.\d+\.\d+$/.test(candidate.tokenId)) {
    return malformed("bad-field-type", `"tokenId" must look like 0.0.x.`, raw);
  }
  if (typeof candidate.ts !== "string") {
    return malformed("bad-field-type", `"ts" must be a string.`, raw);
  }
  if (typeof candidate.actor !== "string") {
    return malformed("bad-field-type", `"actor" must be a string.`, raw);
  }
  if (typeof candidate.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(candidate.payloadHash)) {
    return malformed("bad-field-type", `"payloadHash" must be 64 lowercase hex characters.`, raw);
  }
  if (typeof candidate.payload !== "object" || candidate.payload === null || Array.isArray(candidate.payload)) {
    return malformed("bad-field-type", `"payload" must be an object.`, raw);
  }

  // Unknown top-level fields are kept rather than stripped: a newer writer may
  // carry fields this indexer has not been taught, and losing them on replay
  // would make the rebuilt index disagree with the log.
  const event = candidate as unknown as PassportEvent;

  return {
    ok: true,
    event,
    hashValid: hashPayload(event.payload) === event.payloadHash,
    isCustom: !isBuiltInEventType(event.type),
  };
}

/**
 * Decodes a base64 message body as the mirror node returns it.
 *
 * @param base64 Base64 `message` field from `/api/v1/topics/{id}/messages`.
 * @returns A decoded event, or a malformed record.
 */
export function decodeBase64Event(base64: string): DecodeResult {
  let raw: string;
  try {
    raw = Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return malformed("invalid-json", "Message body is not valid base64.", base64);
  }
  return decodeEvent(raw);
}
