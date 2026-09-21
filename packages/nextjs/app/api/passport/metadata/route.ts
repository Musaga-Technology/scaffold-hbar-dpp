import { fail, guard, ok } from "../_lib/responses";
import { buildHip412Metadata } from "@sh/indexer/events";
import { StorageUnavailableError, hasStorageProvider, requireStorageProvider } from "~~/services/storage";

/** One response shape either way, so a caller does not branch on which it got. */
interface MetadataResponse {
  metadata: ReturnType<typeof buildHip412Metadata>;
  /** Null when no storage provider is configured. */
  cid: string | null;
  /** The `ipfs://…` pointer to mint with, or null to fall back to an app URL. */
  uri: string | null;
  provider?: string;
  reason?: string;
}

/**
 * Pins a serial's HIP-412 metadata and returns the pointer to mint it with.
 *
 * Called before `registerProduct`, because the metadata bytes are an argument
 * to the mint. Returns an `ipfs://` URI, which is what makes a passport's
 * identity independent of this app continuing to exist.
 *
 * With no storage provider configured the caller falls back to a URL served by
 * this app. That works, and it is documented as the weaker option: it makes
 * every NFT's metadata pointer depend on one web server staying up.
 */
export async function POST(request: Request) {
  return guard(async () => {
    let body: {
      category?: unknown;
      topicId?: unknown;
      productHash?: unknown;
      fields?: unknown;
      image?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return fail("invalid_request", "Request body must be JSON.");
    }

    const issues: Array<{ field: string; message: string }> = [];
    if (typeof body.category !== "string" || body.category === "") {
      issues.push({ field: "category", message: "is required" });
    }
    if (typeof body.topicId !== "string" || !/^\d+\.\d+\.\d+$/.test(body.topicId)) {
      issues.push({ field: "topicId", message: "must look like 0.0.x" });
    }
    if (typeof body.productHash !== "string" || !/^(0x)?[0-9a-f]{64}$/i.test(body.productHash)) {
      issues.push({ field: "productHash", message: "must be a sha256 hex digest" });
    }
    if (typeof body.fields !== "object" || body.fields === null || Array.isArray(body.fields)) {
      issues.push({ field: "fields", message: "must be an object" });
    }
    if (issues.length > 0) {
      return fail("invalid_request", "Cannot build metadata from this request.", issues);
    }

    const metadata = buildHip412Metadata({
      category: body.category as string,
      topicId: body.topicId as string,
      productHash: body.productHash as string,
      fields: body.fields as Record<string, unknown>,
      ...(typeof body.image === "string" ? { image: body.image } : {}),
    });

    if (!hasStorageProvider()) {
      // Hand back the document anyway so the caller can fall back to serving it
      // from this app, and say why that is worse.
      return ok<MetadataResponse>({
        metadata,
        cid: null,
        uri: null,
        reason:
          "No storage provider configured, so the metadata could not be pinned. Set PINATA_JWT to make " +
          "each passport's metadata pointer independent of this app staying online.",
      });
    }

    try {
      const provider = await requireStorageProvider();
      const file = new File([JSON.stringify(metadata, null, 2)], "metadata.json", {
        type: "application/json",
      });
      const stored = await provider.put(file);

      const uri = stored.protocol === "arweave" ? `ar://${stored.cid}` : `ipfs://${stored.cid}`;
      return ok<MetadataResponse>({ metadata, cid: stored.cid, uri, provider: provider.name }, 201);
    } catch (error) {
      if (error instanceof StorageUnavailableError) return fail("storage_unavailable", error.message);
      throw error;
    }
  });
}
