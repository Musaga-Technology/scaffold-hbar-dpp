/**
 * Canonical JSON serialisation.
 *
 * Deliberately free of Node imports so the browser, the server routes and the
 * indexer can all use the *same* function. A product hash computed in a browser
 * with a different serialisation than the one the indexer verifies with is a
 * hash nobody can check — which defeats the point of recording it.
 *
 * Its behaviour is pinned by `schemas/event-vectors.json`.
 */

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
