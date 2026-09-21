/**
 * Types for the HCS passport event message.
 *
 * Mirrors `schemas/passport-event.schema.json`. The schema is the contract; this
 * file is the TypeScript view of it.
 */

/** Maximum serialized size of an HCS message this template will submit. */
export const MAX_EVENT_BYTES = 1024;

/** Current event schema version. */
export const EVENT_VERSION = 1;

/** Built-in lifecycle event types. */
export const BUILT_IN_EVENT_TYPES = [
  "product.registered",
  "product.shipped",
  "product.inspected",
  "product.repaired",
  "product.recycled",
  "custody.transferred",
] as const;

export type BuiltInEventType = (typeof BUILT_IN_EVENT_TYPES)[number];

/** Any accepted event type: a built-in, or a namespaced custom one. */
export type EventType = BuiltInEventType | `custom.${string}`;

/** A compact, hash-anchored lifecycle event as carried on HCS. */
export interface PassportEvent {
  /** Event schema version. */
  v: number;
  /** Event type. */
  type: EventType;
  /** HTS serial the event describes. */
  serial: number;
  /** HTS collection id (`0.0.x`). */
  tokenId: string;
  /** Client-supplied timestamp. Consensus time is authoritative, not this. */
  ts: string;
  /** EVM address or Hedera account id of the submitter. */
  actor: string;
  /** sha256 of the canonical JSON of `payload`. */
  payloadHash: string;
  /** Small, typed payload. Large content is referenced, never embedded. */
  payload: Record<string, unknown>;
  /** Hedera transaction id or EVM tx hash of the on-chain action this describes. */
  ref?: string;
  /** Sequence number of the previous event on this topic, when known. */
  prev?: number;
  /** Signature over payloadHash by the actor. */
  sig?: string;
  /** DID of the actor, when identity-anchored. */
  actorDid?: string;
}

/** Reasons a topic message could not be decoded into an event. */
export type MalformedReason =
  | "invalid-json"
  | "not-an-object"
  | "missing-required-field"
  | "bad-field-type"
  | "unsupported-version";

/** A topic message that decoded cleanly. */
export interface DecodedEvent {
  ok: true;
  event: PassportEvent;
  /** True when the recomputed payload hash matches the claimed one. */
  hashValid: boolean;
  /** True when `type` is not one of the built-ins. */
  isCustom: boolean;
}

/** A topic message that did not decode. Kept, never silently dropped. */
export interface MalformedEvent {
  ok: false;
  reason: MalformedReason;
  /** Human-readable detail for the reconciliation note. */
  detail: string;
  /** sha256 of the raw message bytes, so the record is still anchored. */
  rawHash: string;
}

export type DecodeResult = DecodedEvent | MalformedEvent;

/** True when the type is one of the built-in lifecycle types. */
export function isBuiltInEventType(type: string): type is BuiltInEventType {
  return (BUILT_IN_EVENT_TYPES as readonly string[]).includes(type);
}

/** True when the type is a well-formed custom type. */
export function isCustomEventType(type: string): type is `custom.${string}` {
  return /^custom\.[a-z0-9_.-]{1,40}$/.test(type);
}

/** True when the type is accepted by the schema at all. */
export function isKnownEventType(type: string): type is EventType {
  return isBuiltInEventType(type) || isCustomEventType(type);
}
