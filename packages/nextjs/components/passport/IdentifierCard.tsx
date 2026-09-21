import Link from "next/link";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { hashscan } from "~~/lib/hashscan";
import type { PassportProduct } from "~~/lib/indexClient";

const Row = ({ label, value, href, demo }: { label: string; value: string; href?: string; demo?: boolean }) => (
  <div className="flex items-center justify-between gap-4 border-b border-base-300 py-2 last:border-b-0">
    <span className="text-sm text-base-content/60">{label}</span>
    {href ? (
      <Link
        href={href}
        target="_blank"
        rel="noreferrer"
        title={
          demo ? "Demo data — this id is not a real entity on Hedera testnet, so HashScan will not find it" : undefined
        }
        className={`link link-hover inline-flex items-center gap-1 break-all text-right font-mono text-sm ${
          demo ? "text-base-content/50 decoration-dotted" : "text-primary"
        }`}
      >
        {value}
        <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
      </Link>
    ) : (
      <span className="font-mono text-sm break-all text-right">{value}</span>
    )}
  </div>
);

/** The on-ledger identifiers behind a passport, each linked to HashScan. */
export const IdentifierCard = ({ product, demo = false }: { product: PassportProduct; demo?: boolean }) => (
  <div className="rounded-2xl border border-base-300 bg-base-100 p-5">
    <h2 className="mb-3 mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/60">On the ledger</h2>
    <Row label="Token" value={product.tokenId} href={hashscan.token(product.tokenId)} demo={demo} />
    <Row
      label="Serial"
      value={String(product.serial)}
      href={hashscan.serial(product.tokenId, product.serial)}
      demo={demo}
    />
    <Row label="Topic" value={product.topicId} href={hashscan.topic(product.topicId)} demo={demo} />
    {product.currentHolder && (
      <Row
        label="Current holder"
        value={product.currentHolder}
        href={hashscan.account(product.currentHolder)}
        demo={demo}
      />
    )}
    {product.issuer && <Row label="Issued by" value={product.issuer} />}
  </div>
);
