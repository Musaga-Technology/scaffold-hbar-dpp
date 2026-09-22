/**
 * Updating `.env.local` files without destroying what is already in them.
 *
 * The bootstrap used to rewrite these files wholesale. That wiped anything a
 * developer had added by hand — a `PINATA_JWT`, a custom gateway — on every
 * successful run, which is the worst way to lose a setting: the command that
 * erased it reported success. Now only the keys the bootstrap owns are
 * replaced; every other line, comments included, is kept as written.
 */

/**
 * Merges entries into the text of an env file.
 *
 * Keys the file already sets are updated in place. New keys are appended under
 * a comment saying where they came from. Everything else — other keys, blank
 * lines, comments — is left exactly as it was.
 *
 * @param existing Current file contents, or empty for a new file.
 * @param entries Keys and values to set.
 * @param note One line explaining the values, written above any new keys.
 * @returns The new file contents.
 */
export function mergeEnvFile(existing: string, entries: Record<string, string>, note: string): string {
  const pending = new Map(Object.entries(entries));
  const lines = existing.length > 0 ? existing.replace(/\n+$/, "").split("\n") : [];

  const updated = lines.map(line => {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key === undefined || !pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });

  if (pending.size > 0) {
    if (updated.length > 0) updated.push("");
    updated.push(`# Written by \`yarn passport:bootstrap\`. ${note}`);
    for (const [key, value] of pending) updated.push(`${key}=${value}`);
  }

  return `${updated.join("\n")}\n`;
}
