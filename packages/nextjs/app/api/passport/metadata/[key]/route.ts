import { fail, guard, ok } from "../../_lib/responses";
import { getPassport, listProducts } from "~~/lib/indexClient";

/**
 * HIP-412 metadata for one passport.
 *
 * Addressable by serial *or* topic id, and that is not a convenience. The bytes
 * stored on a serial have to be chosen before the mint that assigns the serial,
 * so a metadata URL keyed only by serial cannot be written at registration time.
 * The topic id is known first and identifies the product just as uniquely.
 *
 * The registry caps on-chain metadata at 100 bytes, so what lives on the ledger
 * is a pointer to this document, never the document.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const { key } = await params;

    const product = /^\d+$/.test(key)
      ? (await getPassport(Number(key)))?.product
      : (await listProducts()).find(candidate => candidate.topicId === key);

    if (!product) {
      return fail("not_found", `No passport indexed for "${key}".`);
    }

    let fields: Record<string, unknown> = {};
    try {
      fields = product.metadataJson ? (JSON.parse(product.metadataJson) as Record<string, unknown>) : {};
    } catch {
      fields = {};
    }

    const origin = new URL(request.url).origin;

    return ok({
      name: product.name ?? `Serial ${product.serial}`,
      description:
        "Digital Product Passport. Lifecycle events are recorded on a Hedera Consensus Service topic and " +
        "reconciled against the NFT's on-chain custody history.",
      type: "object",
      format: "HIP412@2.0.0",
      properties: {
        category: product.category ?? "generic",
        topicId: product.topicId,
        productHash: product.productHash,
        verifyUrl: `${origin}/verify/${product.serial}`,
        ...fields,
      },
    });
  });
}
