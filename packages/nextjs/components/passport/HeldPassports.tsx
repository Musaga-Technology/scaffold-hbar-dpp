"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import type { PassportProduct } from "~~/lib/indexClient";

/**
 * Filters the registry down to what the connected wallet holds.
 *
 * Matching is case-insensitive because the mirror node and a wallet disagree on
 * EVM address casing, and a case-sensitive compare would silently show someone
 * an empty list while they were holding passports.
 */
export const HeldPassports = ({ products }: { products: PassportProduct[] }) => {
  const { address } = useAccount();

  const held = products.filter(
    product => product.currentHolder && address && product.currentHolder.toLowerCase() === address.toLowerCase(),
  );

  if (held.length === 0) {
    return (
      <div className="rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <p className="m-0 font-semibold">No passports held by this wallet</p>
        <p className="mx-auto mt-2 mb-0 max-w-md text-sm text-base-content/60">
          Custody here is read from the NFT&apos;s record on the mirror node. If a passport was just transferred to you,
          it appears once the indexer catches up.
        </p>
      </div>
    );
  }

  return (
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
};
