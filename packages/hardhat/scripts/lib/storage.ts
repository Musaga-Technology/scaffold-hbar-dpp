/**
 * Pinning for the bootstrap script.
 *
 * The app has its own provider abstraction in `packages/nextjs/services/storage`,
 * and this does not try to share it: that module is Next.js server-only code,
 * and the two workspaces are separate runtimes. What matters is that both
 * produce the *same document* — which they do, because both build it with
 * `buildHip412Metadata` — not that they share the twenty lines that POST it.
 *
 * If a second provider is ever added here, this is the place to put the seam.
 */

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

/** True when the bootstrap can pin. */
export function canPin(): boolean {
  return Boolean(process.env.PINATA_JWT);
}

/**
 * Pins a JSON document and returns its CID.
 *
 * @param document Any JSON-serialisable value.
 * @param filename Name recorded with the pin, for the operator's benefit.
 * @returns The CID, or undefined when no provider is configured.
 * @throws When a provider is configured but the upload fails, because silently
 *         falling back would mint a token whose metadata pointer is not what the
 *         operator asked for.
 */
export async function pinJson(document: unknown, filename = "metadata.json"): Promise<string | undefined> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return undefined;

  const body = JSON.stringify(document, null, 2);
  const form = new FormData();
  form.append("file", new Blob([body], { type: "application/json" }), filename);

  const response = await fetch(PINATA_PIN_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Pinata rejected the metadata upload: ${response.status} ${response.statusText}. ${detail.slice(0, 200)}\n` +
        "Unset PINATA_JWT to fall back to an app-hosted metadata URL, or fix the key and re-run — " +
        "the bootstrap is idempotent and will not repeat the steps that already succeeded.",
    );
  }

  const parsed = (await response.json()) as { IpfsHash?: string };
  if (!parsed.IpfsHash) throw new Error("Pinata accepted the metadata upload but returned no CID.");

  return parsed.IpfsHash;
}
