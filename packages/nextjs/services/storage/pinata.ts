/**
 * Pinata IPFS provider.
 *
 * Pinata is the default because a free key is enough to run this template end
 * to end on testnet. Nothing here is Pinata-specific beyond the endpoint and
 * the auth header; the StorageProvider interface is the seam for swapping it.
 *
 * The CID is computed here, from the bytes, before anything is uploaded — and
 * Pinata's answer is checked against it rather than taken on trust. The passport
 * commits to that CID permanently, so it has to be the document's own address,
 * not whatever a pinning service reported. See `@sh/indexer/content/ipfs` for
 * the chunking both sides agree on.
 */
import {
  MAX_DOCUMENT_BYTES,
  type StorageProvider,
  StorageUnavailableError,
  type StoredDocument,
  hashFile,
} from "./index";
import { computeCid } from "@sh/indexer/content/ipfs";
import "server-only";

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

interface PinataResponse {
  IpfsHash?: string;
  PinSize?: number;
  error?: unknown;
}

/**
 * Builds a Pinata-backed storage provider.
 *
 * @param jwt Pinata JWT, server-side only.
 * @param gateway Optional dedicated gateway; only affects display, not the CID.
 * @returns A provider that pins documents to IPFS.
 */
export function createPinataProvider(jwt: string, gateway?: string): StorageProvider {
  return {
    name: gateway ? `pinata (${gateway})` : "pinata",

    async put(file: File): Promise<StoredDocument> {
      if (file.size > MAX_DOCUMENT_BYTES) {
        throw new StorageUnavailableError(
          `Document is ${file.size} bytes, over the ${MAX_DOCUMENT_BYTES}-byte limit for this template.`,
        );
      }

      // Hash what actually arrived, before anything is sent anywhere. The
      // passport commits to this digest, so it must be computed from the bytes
      // this server saw rather than taken on trust from the browser.
      const { hash, bytes } = await hashFile(file);
      const cid = await computeCid(bytes);

      const form = new FormData();
      form.append("file", file, file.name);
      // Explicit rather than relying on Pinata's default, because computeCid
      // assumes CIDv1 with raw leaves and the two must agree.
      form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

      let response: Response;
      try {
        response = await fetch(PINATA_PIN_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${jwt}` },
          body: form,
        });
      } catch (error) {
        throw new StorageUnavailableError(
          `Could not reach Pinata: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new StorageUnavailableError(
          `Pinata rejected the upload: ${response.status} ${response.statusText}. ${detail.slice(0, 200)}`,
        );
      }

      const body = (await response.json()) as PinataResponse;
      if (!body.IpfsHash) {
        throw new StorageUnavailableError("Pinata accepted the upload but returned no CID.");
      }

      if (body.IpfsHash !== cid) {
        // Committing Pinata's CID would put an address on the ledger that this
        // server never checked; committing ours would reference content Pinata
        // may not be serving. Neither is safe, so the upload is refused.
        throw new StorageUnavailableError(
          `Pinata stored the document as ${body.IpfsHash}, but its bytes hash to ${cid}. ` +
            "Refusing to attest an address that does not match the content. This usually means the provider " +
            "chunked the file differently; check its CID version settings.",
        );
      }

      return {
        cid,
        protocol: "ipfs",
        hash,
        bytes: file.size,
        name: file.name,
        type: file.type || "application/octet-stream",
      };
    },
  };
}
