"use client";

import Image from "next/image";
import Link from "next/link";
import type { NextPage } from "next";
import { ArrowRightIcon, CubeTransparentIcon, LinkIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

/**
 * Landing page.
 *
 * Increment 03 replaces this with registry stats from /api/passport/stats and a
 * serial search box. Until the index exists this stays dependency-free so the
 * app builds and renders with no wallet, no env and no network.
 */
const Home: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-16 px-5">
        <div className="flex flex-col items-center max-w-3xl mx-auto text-center">
          <Image
            src="/Hedera-Icon-White.svg"
            alt="Hedera icon"
            width={64}
            height={64}
            className="mb-4 hidden dark:block"
          />
          <Image src="/Hedera-Icon-Dark.svg" alt="Hedera icon" width={64} height={64} className="mb-4 dark:hidden" />
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Digital Product Passports</h1>
          <p className="text-xl text-white/80 dark:text-white/60 max-w-2xl">
            Give every physical product a verifiable history: an HTS token for identity, an HCS topic for its ordered
            lifecycle, and an indexer that reconciles the two.
          </p>
        </div>
      </div>

      <div className="w-full max-w-5xl mx-auto px-5 mt-12 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8">How a passport works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-base-100 rounded-2xl shadow-md p-6 text-center flex flex-col items-center border border-base-300">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <CubeTransparentIcon className="h-6 w-6 text-primary" />
            </div>
            <span className="text-xs font-bold text-primary mb-2">IDENTITY</span>
            <h3 className="font-bold text-lg mb-2">One NFT per product</h3>
            <p className="text-base-content/70 text-sm m-0">
              A registry contract mints an HTS non-fungible token through the system contract at 0x167. The serial is
              the product&apos;s identity; whoever holds it has custody.
            </p>
          </div>

          <div className="bg-base-100 rounded-2xl shadow-md p-6 text-center flex flex-col items-center border border-base-300">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <LinkIcon className="h-6 w-6 text-primary" />
            </div>
            <span className="text-xs font-bold text-primary mb-2">HISTORY</span>
            <h3 className="font-bold text-lg mb-2">One topic per product</h3>
            <p className="text-base-content/70 text-sm m-0">
              Manufactured, shipped, inspected, repaired, recycled. Each event is a compact, hash-anchored message on
              the product&apos;s HCS topic, ordered by consensus timestamp.
            </p>
          </div>

          <div className="bg-base-100 rounded-2xl shadow-md p-6 text-center flex flex-col items-center border border-base-300">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <ShieldCheckIcon className="h-6 w-6 text-primary" />
            </div>
            <span className="text-xs font-bold text-primary mb-2">PROOF</span>
            <h3 className="font-bold text-lg mb-2">Reconciled, not trusted</h3>
            <p className="text-base-content/70 text-sm m-0">
              The indexer replays the mirror node and checks every custody claim on HCS against the NFT&apos;s real
              transfer history. Mismatches are shown as a discrepancy, never hidden.
            </p>
          </div>
        </div>

        <div className="mt-12 bg-base-200 rounded-2xl p-8 text-center">
          <h3 className="font-bold text-xl mb-2">Not configured yet</h3>
          <p className="text-base-content/70 mb-6 max-w-2xl mx-auto">
            Run <code className="bg-base-300 px-1.5 py-0.5 rounded">yarn passport:bootstrap</code> to deploy the
            registry, create the collection and register a demo product on Hedera testnet. The public verify page and
            issuer dashboard arrive in increment 03.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/debug" className="btn btn-outline btn-sm">
              Debug Contracts
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
