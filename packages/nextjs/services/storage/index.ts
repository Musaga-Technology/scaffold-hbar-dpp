/**
 * Decentralised storage for passport documents.
 *
 * SERVER ONLY. Pinning credentials belong nowhere near a browser.
 *
 * A Digital Product Passport is mostly documents — conformity certificates,
 * battery test reports, inspection records — and none of them can go on HCS.
 * What goes on the topic is a content-addressed reference, so the address and
 * the integrity proof are the same value. That is the property the whole
 * attachment design rests on, and it is why this is storage rather than a file
 * upload endpoint: a URL is a promise that a server will still exist and still
 * be honest, and a CID is neither.
 *
 * The provider sits behind this interface so the template is not welded to one
 * vendor. Pinata ships as the default because it has a usable free tier and
 * works on testnet budgets; Filebase, web3.storage or a self-hosted IPFS node
 * are the same shape. Arweave, for passports that must outlive the company that
 * made the product, is the documented upgrade — see AGENTS.md.
 */
import "server-only";

/** Where a stored document lives. */
export type StorageProtocol = "ipfs" | "arweave";

/** A document that has been stored and is addressable by content id. */
export interface StoredDocument {
  /** IPFS CID, or Arweave transaction id. */
  cid: string;
  /** Which network it lives on. */
  protocol: StorageProtocol;
  /** sha256 of the raw bytes, computed here rather than trusted from the client. */
  hash: string;
  bytes: number;
  name: string;
  type: string;
}

/** Why a document could not be stored, in a form a route can return as JSON. */
export class StorageUnavailableError extends Error {
  readonly code = "storage_unavailable";
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export interface StorageProvider {
  /** Provider name, for diagnostics and for the UI to report what is configured. */
  readonly name: string;
  /**
   * Pins a document and returns its content address.
   *
   * @param file The uploaded document.
   * @returns The stored document's CID and hash.
   */
  put(file: File): Promise<StoredDocument>;
}

/** Largest document this template will accept. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Computes the sha256 of a file's bytes.
 *
 * Always computed server-side from what actually arrived. Taking a hash from
 * the client would mean the passport commits to a digest nobody verified, which
 * would make the whole attachment guarantee circular.
 */
export async function hashFile(file: File): Promise<{ hash: string; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return { hash, bytes };
}

/** True when a storage provider is configured. */
export function hasStorageProvider(): boolean {
  return Boolean(process.env.ARWEAVE_JWK || process.env.PINATA_JWT);
}

/**
 * Resolves the configured storage provider.
 *
 * @returns The provider.
 * @throws StorageUnavailableError when none is configured.
 */
export async function requireStorageProvider(): Promise<StorageProvider> {
  // Arweave wins when both are set: if an operator has gone to the trouble of
  // configuring permanent storage, they meant it.
  if (process.env.ARWEAVE_JWK) {
    const { createArweaveProvider } = await import("./arweave");
    const network = process.env.ARWEAVE_NETWORK === "mainnet" ? "mainnet" : "devnet";
    return createArweaveProvider(process.env.ARWEAVE_JWK, network);
  }

  if (process.env.PINATA_JWT) {
    const { createPinataProvider } = await import("./pinata");
    return createPinataProvider(process.env.PINATA_JWT, process.env.PINATA_GATEWAY_URL);
  }

  throw new StorageUnavailableError(
    "No storage provider is configured, so documents cannot be attached. Set either PINATA_JWT (IPFS; a free " +
      "key from pinata.cloud is enough) or ARWEAVE_JWK (permanent storage via Irys; devnet uploads are free) " +
      "in packages/nextjs/.env.local — server-side only, never prefixed NEXT_PUBLIC_. Everything else in this " +
      "template works without either.",
  );
}
