/**
 * Canonical JSON and hashing for passport events.
 *
 * This is the reference implementation. Its behaviour is pinned by
 * `schemas/event-vectors.json`, which every other implementation in this repo
 * asserts against — see `packages/hardhat/test/events.conformance.test.ts`.
 * If you change anything here, the vectors change too, and old payload hashes
 * stop verifying. That is a breaking change to the event schema, not a refactor.
 */
import { createHash } from "node:crypto";

/**
 * Serializes a value with object keys sorted and no insignificant whitespace,
 * so the same logical payload always produces the same bytes.
 *
 * `undefined` properties are dropped rather than serialized, matching what
 * `JSON.stringify` does for objects, so an explicitly-absent field and a missing
 * field hash identically.
 *
 * @param value Value to serialize.
 * @returns Canonical JSON text.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);

  return `{${entries.join(",")}}`;
}

/**
 * Returns the lowercase hex sha256 of a UTF-8 string.
 *
 * @param input Text to hash.
 * @returns 64 lowercase hex characters.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Hashes an event payload the way the schema defines: sha256 of its canonical JSON.
 *
 * @param payload Event payload.
 * @returns The payload hash.
 */
export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalize(payload));
}
