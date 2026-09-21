import { fail, guard, ok } from "../_lib/responses";
import {
  MAX_DOCUMENT_BYTES,
  StorageUnavailableError,
  hasStorageProvider,
  requireStorageProvider,
} from "~~/services/storage";

/**
 * Pins a document and returns the reference an event should carry.
 *
 * The response is deliberately not the document — it is a CID and a sha256 of
 * the bytes this server actually received. The caller puts both into the event
 * payload, where `payloadHash` covers them, so the reference cannot be swapped
 * afterwards without breaking the event's own hash.
 *
 * Nothing about the document reaches HCS. That is the point.
 */
export async function POST(request: Request) {
  return guard(async () => {
    if (!hasStorageProvider()) {
      // Say what to configure rather than failing obscurely; every other part
      // of the template works without storage.
      try {
        await requireStorageProvider();
      } catch (error) {
        if (error instanceof StorageUnavailableError) return fail("storage_unavailable", error.message);
        throw error;
      }
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail("invalid_request", "Send the document as multipart/form-data with a `file` field.");
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail("invalid_request", "No file was uploaded.", [
        { field: "file", message: "a non-empty file is required" },
      ]);
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return fail(
        "message_too_large",
        `Document is ${file.size} bytes, over the ${MAX_DOCUMENT_BYTES}-byte limit for this template.`,
      );
    }

    try {
      const provider = await requireStorageProvider();
      const stored = await provider.put(file);

      return ok(
        {
          // Exactly the shape an event payload's `attachments` entry takes.
          attachment: {
            cid: stored.cid,
            hash: stored.hash,
            name: stored.name,
            type: stored.type,
            bytes: stored.bytes,
          },
          uri: `ipfs://${stored.cid}`,
          provider: provider.name,
        },
        201,
      );
    } catch (error) {
      if (error instanceof StorageUnavailableError) return fail("storage_unavailable", error.message);
      throw error;
    }
  });
}
