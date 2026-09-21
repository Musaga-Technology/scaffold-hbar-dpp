import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DemoBanner } from "~~/components/passport/DemoBanner";
import { Documents } from "~~/components/passport/Documents";
import { IdentifierCard } from "~~/components/passport/IdentifierCard";
import { QrPanel } from "~~/components/passport/QrPanel";
import { StatusBadge } from "~~/components/passport/StatusBadge";
import { Timeline } from "~~/components/passport/Timeline";
import { verifyPath } from "~~/lib/hashscan";
import { getPassport, isDemoMode } from "~~/lib/indexClient";

/**
 * The public passport page.
 *
 * A server component on purpose. It needs no wallet, no environment and no
 * client-side data fetching, which is what lets a stranger scan a QR code and
 * read a product's history with nothing installed. It also means the browser
 * never talks to HCS or the mirror node directly — the rule acceptance
 * assertion C8 checks in devtools.
 */

// The index changes as the indexer catches up, so a cached page would show a
// stale "pending" long after it had become "verified".
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ serial: string }>;
}

function parseSerial(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const serial = Number(raw);
  return Number.isInteger(serial) && serial >= 1 ? serial : undefined;
}

/** Reads extra registration fields the category schema recorded. */
function registrationFields(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { serial: raw } = await params;
  const serial = parseSerial(raw);
  if (serial === undefined) return { title: "Passport not found" };

  const passport = await getPassport(serial);
  const name = passport?.product.name ?? `Serial ${serial}`;
  return {
    title: `${name} — Digital Product Passport`,
    description: "Lifecycle history and verification status for this product, anchored on Hedera.",
  };
}

const Verify = async ({ params }: PageProps) => {
  const { serial: raw } = await params;
  const serial = parseSerial(raw);
  if (serial === undefined) notFound();

  const passport = await getPassport(serial);
  if (!passport) notFound();

  const { product, events, attachments } = passport;
  const fields = registrationFields(product.metadataJson);
  const manufacturer = typeof fields.manufacturer === "string" ? fields.manufacturer : undefined;
  const gtin = typeof fields.gtin === "string" ? fields.gtin : undefined;
  const discrepancies = events.filter(event => event.reconciliation === "discrepancy");
  const demo = isDemoMode();

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10">
      {demo && <DemoBanner />}

      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {product.category && <span className="badge badge-outline badge-sm capitalize">{product.category}</span>}
              <span className="text-sm text-base-content/60">Serial {product.serial}</span>
            </div>
            <h1 className="mb-1 text-3xl font-bold break-words">{product.name ?? `Serial ${product.serial}`}</h1>
            {manufacturer && <p className="m-0 text-base-content/70">{manufacturer}</p>}
          </div>

          <StatusBadge status={product.status} />
        </div>
      </header>

      {discrepancies.length > 0 && (
        <div className="alert alert-error mb-8" data-testid="discrepancy-alert">
          <div>
            <h2 className="m-0 text-base font-bold">
              {discrepancies.length === 1
                ? "A claim on this passport"
                : `${discrepancies.length} claims on this passport`}{" "}
              could not be matched on-chain
            </h2>
            <p className="m-0 mt-1 text-sm">
              The lifecycle log says something the ledger does not corroborate. The affected entries are marked below
              with the reason. This is shown rather than hidden — an unverifiable claim is a finding, not a detail to
              smooth over.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="m-0 text-lg font-bold">Lifecycle</h2>
            <span className="text-sm text-base-content/60">
              {events.length} event{events.length === 1 ? "" : "s"}, oldest first
            </span>
          </div>
          <Timeline events={events} tokenId={product.tokenId} serial={product.serial} demo={demo} />
        </section>

        <aside className="flex flex-col gap-6">
          <StatusBadge status={product.status} showBlurb />
          <IdentifierCard product={product} demo={demo} />
          <QrPanel path={verifyPath(product.serial, gtin)} serial={product.serial} />
        </aside>
      </div>

      <Documents attachments={attachments} demo={demo} />

      <footer className="mt-10 border-t border-base-300 pt-6 text-sm text-base-content/60">
        <p className="m-0">
          Custody is read from the NFT&apos;s transfer history on the mirror node; the lifecycle log records what was
          claimed. Where the two disagree, this page shows the disagreement.{" "}
          <Link href="/" className="link link-hover text-primary">
            How this works
          </Link>
        </p>
      </footer>
    </div>
  );
};

export default Verify;
