import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon, CubeTransparentIcon, LinkIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { DemoBanner } from "~~/components/passport/DemoBanner";
import { IndexUnavailable } from "~~/components/passport/IndexUnavailable";
import { SerialSearch } from "~~/components/passport/SerialSearch";
import { StatTiles } from "~~/components/passport/StatTiles";
import { network } from "~~/lib/hashscan";
import { IndexUnavailableError, getStats, isDemoMode, listProducts } from "~~/lib/indexClient";

/**
 * Landing page.
 *
 * A server component reading the index, so it works with no wallet and no
 * configuration. Counts, search and the passport list all come from the index —
 * never from HCS directly.
 */
export const dynamic = "force-dynamic";

const Home = async () => {
  let stats;
  let products;
  try {
    [stats, products] = await Promise.all([getStats(), listProducts()]);
  } catch (error) {
    if (error instanceof IndexUnavailableError) {
      return <IndexUnavailable url={error.url} detail={error.detail} />;
    }
    throw error;
  }
  const demo = isDemoMode();

  return (
    <div className="flex grow flex-col items-center">
      <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full px-5 py-16">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Image
            src="/Hedera-Icon-White.svg"
            alt="Hedera icon"
            width={64}
            height={64}
            className="mb-4 hidden dark:block"
          />
          <Image src="/Hedera-Icon-Dark.svg" alt="Hedera icon" width={64} height={64} className="mb-4 dark:hidden" />
          <h1 className="mb-4 text-4xl font-bold text-white md:text-5xl">Digital Product Passports</h1>
          <p className="max-w-2xl text-xl text-white/80 dark:text-white/60">
            Give every physical product a verifiable history: an HTS token for identity, an HCS topic for its ordered
            lifecycle, and an indexer that reconciles the two.
          </p>
          <div className="mt-8 flex w-full justify-center">
            <SerialSearch />
          </div>
          <p className="mt-3 text-sm text-white/70">
            Running on Hedera {network()}. No wallet needed to verify a passport.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-5 pb-16">
        <div className="-mt-8">{demo && <DemoBanner />}</div>

        <section className="mb-12">
          <StatTiles stats={stats} />
        </section>

        {products.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-3 mt-0 text-lg font-bold">Passports in this registry</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {products.map(product => (
                <Link
                  key={product.serial}
                  href={`/verify/${product.serial}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100 p-4 transition-colors hover:border-primary"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{product.name ?? `Serial ${product.serial}`}</div>
                    <div className="text-xs text-base-content/60">
                      Serial {product.serial}
                      {product.category ? ` · ${product.category}` : ""}
                    </div>
                  </div>
                  <span
                    className={`badge badge-sm ${
                      product.status === "verified"
                        ? "badge-success"
                        : product.status === "discrepancy"
                          ? "badge-error"
                          : "badge-warning"
                    }`}
                  >
                    {product.status}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <h2 className="mb-8 mt-0 text-center text-2xl font-bold">How a passport works</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col items-center rounded-2xl border border-base-300 bg-base-100 p-6 text-center shadow-md">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <CubeTransparentIcon className="h-6 w-6 text-primary" />
            </div>
            <span className="mb-2 text-xs font-bold text-primary">IDENTITY</span>
            <h3 className="mb-2 text-lg font-bold">One NFT per product</h3>
            <p className="m-0 text-sm text-base-content/70">
              A registry contract mints an HTS non-fungible token through the system contract at 0x167. The serial is
              the product&apos;s identity; whoever holds it has custody.
            </p>
          </div>

          <div className="flex flex-col items-center rounded-2xl border border-base-300 bg-base-100 p-6 text-center shadow-md">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <LinkIcon className="h-6 w-6 text-primary" />
            </div>
            <span className="mb-2 text-xs font-bold text-primary">HISTORY</span>
            <h3 className="mb-2 text-lg font-bold">One topic per product</h3>
            <p className="m-0 text-sm text-base-content/70">
              Manufactured, shipped, inspected, repaired, recycled. Each event is a compact, hash-anchored message on
              the product&apos;s HCS topic, ordered by consensus timestamp.
            </p>
          </div>

          <div className="flex flex-col items-center rounded-2xl border border-base-300 bg-base-100 p-6 text-center shadow-md">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheckIcon className="h-6 w-6 text-primary" />
            </div>
            <span className="mb-2 text-xs font-bold text-primary">PROOF</span>
            <h3 className="mb-2 text-lg font-bold">Reconciled, not trusted</h3>
            <p className="m-0 text-sm text-base-content/70">
              The indexer replays the mirror node and checks every custody claim on HCS against the NFT&apos;s real
              transfer history. Mismatches are shown as a discrepancy, never hidden.
            </p>
          </div>
        </div>

        <div className="mt-12 rounded-2xl bg-base-200 p-8 text-center">
          <h3 className="mb-2 mt-0 text-xl font-bold">
            {demo ? "Exploring demo data" : "Connected to a live registry"}
          </h3>
          <p className="mx-auto mb-6 max-w-2xl text-base-content/70">
            {demo ? (
              <>
                Run <code className="rounded bg-base-300 px-1.5 py-0.5">yarn passport:bootstrap</code> to deploy the
                registry and register a real product on Hedera {network()}, then{" "}
                <code className="rounded bg-base-300 px-1.5 py-0.5">yarn indexer:dev</code> to index it.
              </>
            ) : (
              <>
                Reads come from the index, which is rebuildable from the mirror node at any time. Run{" "}
                <code className="rounded bg-base-300 px-1.5 py-0.5">yarn indexer:verify</code> to prove it matches the
                ledger.
              </>
            )}
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/verify/1" className="btn btn-primary btn-sm">
              Open a passport
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link href="/issuer" className="btn btn-outline btn-sm">
              Issuer dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
