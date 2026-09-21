"use client";

import { useAccount } from "wagmi";
import { WalletIcon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";

/**
 * Wraps a page that cannot function without a connected wallet.
 *
 * Renders a clear prompt rather than a disabled form, and a stable skeleton
 * while wagmi reconnects — a page that flashes "connect your wallet" at someone
 * who is already connected reads as broken.
 */
export const WalletGate = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const { address, status } = useAccount();

  if (status === "connecting" || status === "reconnecting") {
    return (
      <div className="rounded-2xl border border-base-300 bg-base-100 p-10 text-center">
        <div className="mx-auto h-6 w-48 animate-pulse rounded bg-base-200" aria-hidden />
        <p className="mt-3 mb-0 text-sm text-base-content/60">Reconnecting your wallet…</p>
      </div>
    );
  }

  if (status !== "connected" || !address) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-base-300 bg-base-100 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <WalletIcon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="m-0 text-lg font-bold">{title}</h2>
          <p className="mx-auto mt-1 mb-0 max-w-md text-sm text-base-content/70">
            Connect a wallet to continue. Verifying a passport never needs one — only issuing and transferring do.
          </p>
        </div>
        <RainbowKitCustomConnectButton />
      </div>
    );
  }

  return <>{children}</>;
};
