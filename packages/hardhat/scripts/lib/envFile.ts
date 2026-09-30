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

/**
 * Reads one key's value from the text of an env file.
 *
 * @param text File contents.
 * @param key Variable name.
 * @returns The value with surrounding whitespace and quotes removed, or
 *          undefined when the key is absent or empty.
 */
export function readEnvValue(text: string, key: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match?.[1] !== key) continue;
    const value = match[2]!
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .trim();
    return value || undefined;
  }
  return undefined;
}

/**
 * The operator id to add to the app's env file, if any.
 *
 * The id is public — it is on every transaction the operator pays for — so the
 * bootstrap can fill it in, and the one thing left for the developer is the
 * private key, which must stay manual. It is written only when the file has no
 * id yet: a developer who chose a different operator set that account's key
 * too, and replacing only the id would pair it with the wrong key.
 *
 * @param existing Current contents of the app's env file.
 * @param accountId The operator the bootstrap used, `0.0.x`.
 * @returns An entry to merge, or nothing.
 */
export function operatorIdEntry(existing: string, accountId: string): Record<string, string> {
  return readEnvValue(existing, "HEDERA_OPERATOR_ID") ? {} : { HEDERA_OPERATOR_ID: accountId };
}
