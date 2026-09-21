"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useChainId } from "wagmi";
import { ArrowTopRightOnSquareIcon, ClockIcon } from "@heroicons/react/24/outline";
import { useHederaAccountId } from "~~/hooks/scaffold-hbar/useHederaAccountId";
import { hashscan } from "~~/lib/hashscan";
import type { PassportProduct } from "~~/lib/indexClient";

/** A pending airdrop as the mirror node reports it. */
interface PendingAirdrop {
  token_id?: string;
  serial_number?: number;
  sender_id?: string;
}

/**
 * Passports airdropped to this wallet that it does not hold yet.
 *
 * Claiming cannot happen here, and the honest thing is to say so rather than
 * render a button that cannot work. A claim must be signed by the *receiver's*
 * key; this app holds an operator key, which is a different account. The HTS
 * system contract interface vendored with this template does not expose
 * `claimAirdrops` either, so there is no wallet-signed contract call to offer.
 *
 * What is useful is showing that something is waiting, and where to go.
 */
const PendingAirdrops = ({ accountId }: { accountId: string }) => {
  const [pending, setPending] = useState<PendingAirdrop[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/passport/airdrop?accountId=${accountId}`)
      .then(response => (response.ok ? response.json() : { pending: [] }))
      .then(body => {
        if (!cancelled) setPending(body.pending ?? []);
      })
      .catch(() => {
        // A mirror node hiccup should not blank the page; the held list below
        // is the primary content and does not depend on this.
        if (!cancelled) setPending([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (!loaded || pending.length === 0) return null;

  return (
    <section className="mb-8" data-testid="pending-airdrops">
      <div className="rounded-2xl border border-warning bg-warning/5 p-5">
        <div className="mb-2 flex items-center gap-2">
          <ClockIcon className="h-5 w-5 text-warning" />
          <h2 className="m-0 text-lg font-bold">
            {pending.length === 1 ? "A passport is waiting for you" : `${pending.length} passports are waiting`}
          </h2>
        </div>

        <p className="mb-3 mt-0 text-sm text-base-content/80">
          These were airdropped to {accountId} but are not yours until you claim them. Claiming has to be signed by your
          own key, so it happens in your wallet rather than here — HashPack and Blade both list pending airdrops.
        </p>

        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {pending.map((airdrop, index) => (
            <li
              key={`${airdrop.token_id}-${airdrop.serial_number}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-100 p-3 text-sm"
            >
              <span className="font-mono">
                {airdrop.token_id}
                {airdrop.serial_number !== undefined ? ` · serial ${airdrop.serial_number}` : ""}
              </span>
              <span className="flex items-center gap-3">
                {airdrop.serial_number !== undefined && (
                  <Link href={`/verify/${airdrop.serial_number}`} className="link link-hover text-primary">
                    Inspect before claiming
                  </Link>
                )}
                {airdrop.token_id && (
                  <a
                    href={hashscan.token(airdrop.token_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="link link-hover inline-flex items-center gap-1 text-xs text-base-content/60"
                  >
                    HashScan
                    <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

/**
 * Filters the registry down to what the connected wallet holds.
 *
 * Matching is case-insensitive because the mirror node and a wallet disagree on
 * EVM address casing, and a case-sensitive compare would silently show someone
 * an empty list while they were holding passports.
 */
export const HeldPassports = ({ products }: { products: PassportProduct[] }) => {
  const { address } = useAccount();
  const chainId = useChainId();
  const { accountId } = useHederaAccountId(address, chainId);

  const held = products.filter(
    product => product.currentHolder && address && product.currentHolder.toLowerCase() === address.toLowerCase(),
  );

  const heldList =
    held.length === 0 ? (
      <div className="rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <p className="m-0 font-semibold">No passports held by this wallet</p>
        <p className="mx-auto mt-2 mb-0 max-w-md text-sm text-base-content/60">
          Custody here is read from the NFT&apos;s record on the mirror node. If a passport was just transferred to you,
          it appears once the indexer catches up.
        </p>
      </div>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2">
        {held.map(product => (
          <Link
            key={product.serial}
            href={`/verify/${product.serial}`}
            className="rounded-xl border border-base-300 bg-base-100 p-4 transition-colors hover:border-primary"
          >
            <div className="truncate font-semibold">{product.name ?? `Serial ${product.serial}`}</div>
            <div className="mt-1 text-xs text-base-content/60">
              Serial {product.serial}
              {product.category ? ` · ${product.category}` : ""}
            </div>
          </Link>
        ))}
      </div>
    );

  return (
    <>
      {accountId && <PendingAirdrops accountId={accountId} />}
      {heldList}
    </>
  );
};
