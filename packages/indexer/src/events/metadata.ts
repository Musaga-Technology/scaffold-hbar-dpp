/**
 * HIP-412 token metadata for a passport serial.
 *
 * Built here, pinned by whoever is registering — the app or the bootstrap
 * script — so both produce the same document and an NFT minted either way looks
 * identical to HashScan and to wallets.
 *
 * Why this matters more than it looks: the bytes stored on an HTS serial are
 * the only pointer a wallet or an explorer has to what the token *is*. Pointing
 * them at the issuer's own web app makes every passport's identity depend on
 * that app still being online — which is a strange property for a record meant
 * to outlive the product, and a worse one for a record meant to outlive the
 * company. A CID does not go down.
 *
 * HIP-412 metadata is immutable for the life of the serial, so this is a
 * snapshot taken at registration. Everything that changes afterwards — custody,
 * lifecycle events, verification status — belongs on the verify page, which
 * reads the index. The two are not competing copies.
 */

/** The subset of HIP-412 this template writes. */
export interface Hip412Metadata {
  name: string;
  description: string;
  type: string;
  format: "HIP412@2.0.0";
  properties: Record<string, unknown>;
  image?: string;
}

export interface BuildMetadataInput {
  /** Product category id, as in `schemas/categories/`. */
  category: string;
  /** HCS topic carrying this product's lifecycle log. */
  topicId: string;
  /** sha256 of the canonical registration payload. */
  productHash: string;
  /** The registration fields themselves. */
  fields: Record<string, unknown>;
  /** Optional image reference, ideally `ipfs://…`. */
  image?: string;
}

/**
 * Builds the HIP-412 document for a serial.
 *
 * Note what is absent: the serial number and a verify URL. Neither can be known
 * here — the metadata bytes are an argument to the mint that assigns the serial.
 * The topic id identifies the product just as uniquely and is known first, so it
 * is what the document carries.
 *
 * @param input Registration details.
 * @returns A HIP-412 metadata document.
 */
export function buildHip412Metadata(input: BuildMetadataInput): Hip412Metadata {
  const name = typeof input.fields.name === "string" ? input.fields.name : `Passport ${input.topicId}`;
  const manufacturer = typeof input.fields.manufacturer === "string" ? input.fields.manufacturer : undefined;

  return {
    name,
    description:
      `Digital Product Passport${manufacturer ? ` for a product by ${manufacturer}` : ""}. ` +
      `Lifecycle events are recorded on Hedera Consensus Service topic ${input.topicId} and reconciled ` +
      `against this token's on-chain custody history. Referenced documents are content-addressed and ` +
      `re-verified against the hashes committed on HCS.`,
    type: "object",
    format: "HIP412@2.0.0",
    ...(input.image ? { image: input.image } : {}),
    properties: {
      category: input.category,
      topicId: input.topicId,
      productHash: input.productHash,
      ...input.fields,
    },
  };
}

/**
 * Largest metadata pointer the registry will store on a serial.
 *
 * `PassportRegistry.METADATA_MAX_BYTES`. An `ipfs://` URI is about 60 bytes and
 * fits comfortably; a long https URL to a hosted app may not, which is another
 * quiet argument for content addressing.
 */
export const METADATA_POINTER_MAX_BYTES = 100;

/**
 * Checks that a pointer will fit in the registry's metadata field.
 *
 * @param pointer The `ipfs://…` or `https://…` reference.
 * @returns Whether it fits, and its byte length.
 */
export function checkMetadataPointer(pointer: string): { fits: boolean; bytes: number } {
  // TextEncoder rather than Buffer: this runs in the browser too.
  const bytes = new TextEncoder().encode(pointer).length;
  return { fits: bytes <= METADATA_POINTER_MAX_BYTES, bytes };
}
