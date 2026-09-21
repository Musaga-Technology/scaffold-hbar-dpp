import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { ManagePassport } from "~~/components/passport/ManagePassport";
import { StatusBadge } from "~~/components/passport/StatusBadge";
import { Timeline } from "~~/components/passport/Timeline";
import { WalletGate } from "~~/components/passport/WalletGate";
import { getPassport, isDemoMode } from "~~/lib/indexClient";

/** Manage one passport: log events, transfer custody, review history. */
export const dynamic = "force-dynamic";

const ManagePage = async ({ params }: { params: Promise<{ serial: string }> }) => {
  const { serial: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();

  const serial = Number(raw);
  const passport = await getPassport(serial);
  if (!passport) notFound();

  const { product, events } = passport;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10">
      <Link href="/issuer" className="link link-hover mb-4 inline-flex items-center gap-1 text-sm">
        <ArrowLeftIcon className="h-4 w-4" />
        All products
      </Link>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="mb-1 mt-0 text-3xl font-bold break-words">{product.name ?? `Serial ${product.serial}`}</h1>
          <p className="m-0 text-sm text-base-content/60">
            Serial {product.serial} · token {product.tokenId} · topic {product.topicId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={product.status} />
          <Link href={`/verify/${product.serial}`} className="btn btn-outline btn-sm">
            Public page
          </Link>
        </div>
      </header>

      <section className="mb-10">
        <WalletGate title="Managing a passport needs a wallet">
          <ManagePassport
            serial={product.serial}
            tokenId={product.tokenId}
            topicId={product.topicId}
            category={product.category}
            currentHolder={product.currentHolder}
          />
        </WalletGate>
      </section>

      <section>
        <h2 className="mb-3 mt-0 text-lg font-bold">History</h2>
        <Timeline events={events} tokenId={product.tokenId} serial={product.serial} demo={isDemoMode()} />
      </section>
    </div>
  );
};

export default ManagePage;
