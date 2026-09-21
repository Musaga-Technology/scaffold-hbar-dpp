/**
 * Hashing for passport events.
 *
 * The canonicaliser lives in `canonicalize.ts`, which has no Node imports so the
 * browser can use it too. This module adds the digest, which uses node:crypto
 * and is therefore server-side only.
 *
 * Behaviour is pinned by `schemas/event-vectors.json`. If you change any of it,
 * the vectors change too and every payload hash already written to a topic stops
 * verifying — that is a breaking schema change, not a refactor.
 */
import { createHash } from "node:crypto";

export { canonicalize } from "./canonicalize.js";
import { canonicalize } from "./canonicalize.js";

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
