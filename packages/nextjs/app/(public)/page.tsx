import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon, CheckBadgeIcon, DocumentCheckIcon, LinkIcon } from "@heroicons/react/24/outline";
import { DemoBanner } from "~~/components/passport/DemoBanner";
import { IndexUnavailable } from "~~/components/passport/IndexUnavailable";
import { SerialSearch } from "~~/components/passport/SerialSearch";
import { StatTiles } from "~~/components/passport/StatTiles";
import { network } from "~~/lib/hashscan";
import { IndexUnavailableError, getStats, isDemoMode, listProducts } from "~~/lib/indexClient";

/**
 * Landing page.
 *
 * Ordered by what a first-time visitor needs, which is not what the system is
 * made of. Earlier versions opened with "an HTS token for identity, an HCS topic
 * for its ordered lifecycle, and an indexer that reconciles the two" — true, and
 * useless to someone deciding what to click. The architecture now comes after
 * the thing it describes.
 *
 * A server component reading the index, so it works with no wallet and no
 * configuration.
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
  const first = products[0];
  const flagged = products.find(product => product.status === "discrepancy");

  return (
    <div className="flex grow flex-col items-center">
      <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full px-5 py-14">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Image src="/Hedera-Icon-White.svg" alt="" width={52} height={52} className="mb-4 hidden dark:block" />
          <Image src="/Hedera-Icon-Dark.svg" alt="" width={52} height={52} className="mb-4 dark:hidden" />

          <h1 className="mb-4 text-4xl font-bold text-white md:text-5xl">
            Every product, with a history you can check
          </h1>
          <p className="max-w-xl text-lg text-white/85 dark:text-white/60">
            Scan a battery, a garment, a pallet of coffee — and see everywhere it has been, who has held it, and which
            certificates still hold up. Nothing here asks you to take our word for it.
          </p>

          {/* One obvious thing to do. Everything else on this page is secondary. */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {first && (
              <Link href={`/verify/${first.serial}`} className="btn btn-lg bg-white text-primary hover:bg-white/90">
                Open a passport
                <ArrowRightIcon className="h-5 w-5" />
              </Link>
            )}
            <Link
              href="/issuer"
              className="btn btn-lg btn-outline border-white text-white hover:border-white hover:bg-white/10"
            >
              Register a product
            </Link>
          </div>

          <p className="mt-4 text-sm text-white/70">Hedera {network()} · verifying needs no wallet and no account</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-5 pb-16">
        <div className="-mt-6">{demo && <DemoBanner />}</div>

        {flagged && (
          <Link
            href={`/verify/${flagged.serial}`}
            className="mb-8 flex items-start gap-3 rounded-2xl border border-error bg-error/5 p-5 transition-colors hover:border-error/70"
          >
            <DocumentCheckIcon className="mt-0.5 h-6 w-6 shrink-0 text-error" />
            <span>
              <span className="block font-bold">
                See what a failed check looks like → {flagged.name ?? `serial ${flagged.serial}`}
              </span>
              <span className="mt-1 block text-sm text-base-content/70">
                This passport claims something the ledger does not support. Rather than hiding it behind a green tick,
                the page shows exactly which claim failed and why. That is the point of the whole system.
              </span>
            </span>
          </Link>
        )}

        {products.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 mt-0 text-lg font-bold">
              {products.length === 1 ? "The passport in this registry" : `All ${products.length} passports`}
            </h2>
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
                    className={`badge badge-sm shrink-0 ${
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

        <section className="mb-12">
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-base-300 bg-base-100 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="m-0 font-bold">Know the serial number?</h2>
              <p className="m-0 text-sm text-base-content/60">Go straight to that product&apos;s passport.</p>
            </div>
            <SerialSearch />
          </div>
        </section>

        <section className="mb-12">
          <StatTiles stats={stats} />
        </section>

        <h2 className="mb-2 mt-0 text-center text-2xl font-bold">How a passport stays honest</h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-base-content/70">
          Three records, kept separately on purpose, and continuously checked against each other.
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <CheckBadgeIcon className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-bold">Which item this is</h3>
            <p className="m-0 text-sm text-base-content/70">
              Each product gets one token on Hedera. Whoever holds it holds the product — and that ownership record is
              the network&apos;s, not ours.
            </p>
          </div>

          <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <LinkIcon className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-bold">What happened to it</h3>
            <p className="m-0 text-sm text-base-content/70">
              Manufactured, shipped, inspected, repaired, recycled — each written to an append-only log and stamped with
              the time the network agreed on, not the time someone typed.
            </p>
          </div>

          <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <DocumentCheckIcon className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-bold">Whether it all adds up</h3>
            <p className="m-0 text-sm text-base-content/70">
              Claims get checked against what the ledger actually recorded, and certificates get re-downloaded and
              re-hashed. Anything that disagrees is shown as a discrepancy.
            </p>
          </div>
        </div>

        <div className="mt-12 rounded-2xl bg-base-200 p-8 text-center">
          <h3 className="mb-2 mt-0 text-xl font-bold">
            {demo ? "This is sample data" : "Connected to a live registry"}
          </h3>
          <p className="mx-auto mb-6 max-w-2xl text-base-content/70">
            {demo ? (
              <>
                Run <code className="rounded bg-base-300 px-1.5 py-0.5">yarn passport:bootstrap</code> to put a real
                product on Hedera {network()}, then{" "}
                <code className="rounded bg-base-300 px-1.5 py-0.5">yarn indexer:dev</code> to index it. The passports
                above are replaced by your own.
              </>
            ) : (
              <>
                These are real products on Hedera {network()}. Every link goes to HashScan, and{" "}
                <code className="rounded bg-base-300 px-1.5 py-0.5">yarn indexer:verify</code> rebuilds this index from
                scratch to prove it matches the ledger.
              </>
            )}
          </p>
          <Link href="/issuer" className="btn btn-primary btn-sm">
            Register your own product
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Home;
