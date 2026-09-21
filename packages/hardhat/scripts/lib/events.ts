/**
 * Compact HCS passport events.
 *
 * Mirrors `schemas/passport-event.schema.json`. Messages must stay small: HCS
 * charges per submit and a topic is a log, not a document store. Anything large
 * — a certificate, a photo, a test report — is referenced by hash and URL, never
 * embedded.
 *
 * NOTE: increment 02 extracts this into a workspace shared by the app and the
 * indexer, so there is exactly one canonicalisation. Until then this is the
 * single implementation and the others are written against it.
 */
import { createHash } from "node:crypto";

/** Maximum serialized size of an HCS message this template will submit. */
export const MAX_EVENT_BYTES = 1024;

/** Event schema version. */
export const EVENT_VERSION = 1;

/** Built-in lifecycle event types. */
export const EVENT_TYPES = [
  "product.registered",
  "product.shipped",
  "product.inspected",
  "product.repaired",
  "product.recycled",
  "custody.transferred",
] as const;

export type EventType = (typeof EVENT_TYPES)[number] | `custom.${string}`;

/** A compact, hash-anchored lifecycle event. */
export interface PassportEvent {
  v: number;
  type: EventType;
  serial: number;
  tokenId: string;
  ts: string;
  actor: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  ref?: string;
  prev?: number;
}

/** Input for building an event. */
export interface BuildEventInput {
  type: EventType;
  serial: number;
  tokenId: string;
  actor: string;
  payload: Record<string, unknown>;
  ref?: string;
  prev?: number;
  ts?: Date;
}

/**
 * Serializes a value with object keys sorted, so the same payload always hashes
 * to the same digest regardless of property order.
 *
 * @param value Value to serialize.
 * @returns Canonical JSON with no insignificant whitespace.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);

  return `{${entries.join(",")}}`;
}

/** Returns the lowercase hex sha256 of a string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Builds a validated, hash-anchored event ready for submission.
 *
 * @param input Event fields; `ts` defaults to now.
 * @returns The event and its serialized form.
 * @throws When the serialized message would exceed MAX_EVENT_BYTES.
 */
export function buildEvent(input: BuildEventInput): { event: PassportEvent; message: string } {
  const event: PassportEvent = {
    v: EVENT_VERSION,
    type: input.type,
    serial: input.serial,
    tokenId: input.tokenId,
    ts: (input.ts ?? new Date()).toISOString(),
    actor: input.actor,
    payloadHash: sha256Hex(canonicalize(input.payload)),
    payload: input.payload,
    ...(input.ref === undefined ? {} : { ref: input.ref }),
    ...(input.prev === undefined ? {} : { prev: input.prev }),
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
