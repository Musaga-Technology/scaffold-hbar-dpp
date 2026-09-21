/**
 * Arweave provider, via Irys.
 *
 * The reason to reach for this rather than IPFS pinning is persistence, not
 * decentralisation — both are decentralised. IPFS content survives only while
 * somebody keeps paying to pin it. A Digital Product Passport for an EV battery
 * has to still resolve in fifteen to twenty years, quite possibly after the
 * manufacturer has stopped paying for anything at all. Arweave is paid once and
 * stored by endowment, which is the primitive that situation actually calls for.
 *
 * That failure mode is already visible in this template: an attachment whose
 * pin has lapsed shows as `unreachable` on the passport page. Arweave is the
 * answer to that state, not a second flavour of the same thing.
 *
 * Irys rather than raw Arweave because it accepts payment in tokens other than
 * AR, bundles small uploads, and has a free devnet for development — devnet
 * data is pruned after roughly sixty days, which is fine for a template's
 * demo and is stated plainly in the docs rather than glossed.
 */
import {
  MAX_DOCUMENT_BYTES,
  type StorageProvider,
  StorageUnavailableError,
  type StoredDocument,
  hashFile,
} from "./index";
import "server-only";

/** Irys upload endpoints. */
const IRYS_NODES = {
  mainnet: "https://node2.irys.xyz",
  devnet: "https://devnet.irys.xyz",
} as const;

export type IrysNetwork = keyof typeof IRYS_NODES;

/**
 * The slice of the Irys SDK this provider uses.
 *
 * Declared here rather than imported so `@irys/sdk` stays an optional
 * dependency. Most teams scaffolding this template will use IPFS and should not
 * have to install an Arweave SDK to do it — the install is already 2.6 GB. The
 * dynamic import below fails with an instruction if it is genuinely needed.
 */
interface IrysClient {
  upload(data: Buffer, options?: { tags?: Array<{ name: string; value: string }> }): Promise<{ id: string }>;
}

type IrysConstructor = new (config: { url: string; token: string; key: unknown }) => IrysClient;

/**
 * Builds an Arweave-backed storage provider.
 *
 * Uploads go through Irys, which signs with an Arweave JWK. The key is read
 * from the environment as JSON and never leaves the server.
 *
 * @param jwkJson Arweave JWK as a JSON string.
 * @param network Which Irys node to use.
 * @returns A provider that stores documents permanently.
 */
export function createArweaveProvider(jwkJson: string, network: IrysNetwork = "devnet"): StorageProvider {
  return {
    name: `arweave via irys (${network})`,

    async put(file: File): Promise<StoredDocument> {
      if (file.size > MAX_DOCUMENT_BYTES) {
        throw new StorageUnavailableError(
          `Document is ${file.size} bytes, over the ${MAX_DOCUMENT_BYTES}-byte limit for this template.`,
        );
      }

      // Hash what actually arrived, before anything is sent anywhere — the
      // passport commits to this digest, so it must come from the bytes this
      // server saw rather than from the browser's word for it.
      const { hash, bytes } = await hashFile(file);

      let Irys: IrysConstructor;
      try {
        // The specifier is a variable on purpose: a literal would make both
        // TypeScript and webpack resolve a package that is deliberately optional,
        // and the build would fail for everyone using IPFS.
        const specifier = "@irys/sdk";
        const loaded = (await import(/* webpackIgnore: true */ specifier)) as { default: IrysConstructor };
        Irys = loaded.default;
      } catch {
        throw new StorageUnavailableError(
          "The Arweave provider needs @irys/sdk. Install it with `yarn workspace @sh/nextjs add @irys/sdk`, " +
            "or unset ARWEAVE_JWK to use IPFS instead.",
        );
      }

      let key: unknown;
      try {
        key = JSON.parse(jwkJson);
      } catch {
        throw new StorageUnavailableError("ARWEAVE_JWK is not valid JSON. It should be an Arweave JWK object.");
      }

      try {
        const irys = new Irys({ url: IRYS_NODES[network], token: "arweave", key });
        const receipt = await irys.upload(Buffer.from(bytes), {
          tags: [
            { name: "Content-Type", value: file.type || "application/octet-stream" },
            { name: "File-Name", value: file.name },
            // Tagged so a passport's documents can be found on Arweave itself,
            // independently of this app or its index.
            { name: "App-Name", value: "product-passport" },
            { name: "Sha256", value: hash },
          ],
        });

        return {
          cid: receipt.id,
          protocol: "arweave",
          hash,
          bytes: file.size,
          name: file.name,
          type: file.type || "application/octet-stream",
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new StorageUnavailableError(
          `Irys rejected the upload: ${detail}. On mainnet this usually means the signing account has no ` +
            "balance; uploads under 100 kB are free, larger ones are not. Devnet uploads are free but pruned " +
            "after about sixty days.",
        );
      }
    },
  };
}
