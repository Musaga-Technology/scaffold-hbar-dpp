/**
 * HashScan links and Hedera timestamp handling.
 *
 * Client-safe: reads only `NEXT_PUBLIC_HEDERA_NETWORK`, never the operator
 * config. Every claim the UI renders carries a link back to the ledger so a
 * reader can check it themselves rather than taking this app's word for it —
 * that is what acceptance assertion C2 enforces.
 */

export type HederaNetwork = "testnet" | "mainnet" | "previewnet";

/** The network the UI is pointed at. */
export function network(): HederaNetwork {
  const raw = (process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? "testnet").toLowerCase();
  return raw === "mainnet" || raw === "previewnet" ? raw : "testnet";
}

function base(): string {
  return `https://hashscan.io/${network()}`;
}

export const hashscan = {
  contract: (address: string) => `${base()}/contract/${address}`,
  token: (tokenId: string) => `${base()}/token/${tokenId}`,
  serial: (tokenId: string, serial: number) => `${base()}/token/${tokenId}/${serial}`,
  topic: (topicId: string) => `${base()}/topic/${topicId}`,
  transaction: (transactionId: string) => `${base()}/transaction/${transactionId}`,
  account: (accountId: string) => `${base()}/account/${accountId}`,
};

/**
 * Picks the best HashScan link for one lifecycle event.
 *
 * An event that names the transaction it describes links straight to it; one
 * that does not links to the topic that carries it. Every event gets a link
 * either way — an entry a reader cannot verify is worse than no entry.
 *
 * @param topicId Topic carrying the event.
 * @param ref Transaction id the event references, when it has one.
 * @returns A URL and a short label describing what it points at.
 */
export function eventLink(topicId: string, ref: string | null): { href: string; label: string } {
  if (ref && ref.includes("@")) {
    return { href: hashscan.transaction(ref), label: "Transaction" };
  }
  return { href: hashscan.topic(topicId), label: "Topic" };
}

/**
 * Converts a Hedera `seconds.nanos` consensus timestamp to a Date.
 *
 * @param consensusTimestamp Timestamp as the mirror node reports it.
 * @returns The instant, or undefined when it cannot be parsed.
 */
export function consensusDate(consensusTimestamp: string): Date | undefined {
  const seconds = Number.parseFloat(consensusTimestamp);
  if (!Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000);
}

/**
 * Formats a consensus timestamp for display.
 *
 * Always UTC and always explicit. A provenance record read in another country
 * a decade from now should not be ambiguous about when something happened.
 *
 * @param consensusTimestamp Timestamp as the mirror node reports it.
 * @returns An absolute UTC string, or the raw value if it cannot be parsed.
 */
export function formatConsensusTime(consensusTimestamp: string): string {
  const date = consensusDate(consensusTimestamp);
  if (!date) return consensusTimestamp;
  return `${date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "")} UTC`;
}

/** Shortens an account id or EVM address for inline display. */
export function shortActor(actor: string | null): string {
  if (!actor) return "unknown";
  if (actor.startsWith("0x") && actor.length > 12) {
    return `${actor.slice(0, 6)}…${actor.slice(-4)}`;
  }
  return actor;
}

/**
 * Builds the URL a passport's QR code encodes.
 *
 * With a GTIN this is a GS1 Digital Link, the data-carrier format the retail
 * and DPP world already scans; without one it is the plain verify path.
 *
 * @param serial Passport serial.
 * @param gtin Product GTIN, when the category records one.
 * @returns A site-relative path.
 */
export function verifyPath(serial: number, gtin?: string | null): string {
  return gtin ? `/01/${gtin}/21/${serial}` : `/verify/${serial}`;
}
