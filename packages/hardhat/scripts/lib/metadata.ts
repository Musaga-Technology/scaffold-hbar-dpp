/**
 * HIP-412 metadata for the bootstrap script.
 *
 * The reference implementation is `packages/indexer/src/events/metadata.ts`.
 * This workspace runs as CommonJS under ts-node while the indexer is ESM, so it
 * keeps a copy — the same reason `lib/events.ts` exists.
 *
 * `packages/hardhat/test/metadata.conformance.test.ts` asserts the two produce
 * byte-identical documents, so a passport minted by the bootstrap and one minted
 * from the issuer page cannot drift apart.
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
  category: string;
  topicId: string;
  productHash: string;
  fields: Record<string, unknown>;
  image?: string;
}

/** Largest metadata pointer `PassportRegistry` will store on a serial. */
export const METADATA_POINTER_MAX_BYTES = 100;

/** Checks that a pointer fits in the registry's metadata field. */
export function checkMetadataPointer(pointer: string): { fits: boolean; bytes: number } {
  // TextEncoder rather than Buffer: this runs in the browser too.
  const bytes = new TextEncoder().encode(pointer).length;
  return { fits: bytes <= METADATA_POINTER_MAX_BYTES, bytes };
}

/**
 * Builds the HIP-412 document for a serial.
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
