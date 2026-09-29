"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { WalletIcon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";

/** How long to show the reconnecting skeleton before offering to connect instead. */
const RECONNECT_GRACE_MS = 4000;

/**
 * Wraps a page that cannot function without a connected wallet.
 *
 * Renders a clear prompt rather than a disabled form, and a stable skeleton
 * while wagmi reconnects — a page that flashes "connect your wallet" at someone
 * who is already connected reads as broken.
 *
 * "Connected" means wagmi knows the address, which is what the header uses too.
 * This used to wait for `status === "connected"` instead. On a page load wagmi
 * restores the previous session with the address known at once, but through
 * MetaMask's SDK the status can sit at "reconnecting" indefinitely — so the
 * header showed the wallet as connected while this gate said "Reconnecting…"
 * forever, on every refresh. Writes do not need the status either: they use the
 * restored connection, the same one that supplies the address.
 */
export const WalletGate = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const { address, status } = useAccount();
  const pending = status === "connecting" || status === "reconnecting";

  // A reconnect that never settles must not hold the page hostage.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!pending) {
      setGaveUp(false);
      return;
    }
    const timer = setTimeout(() => setGaveUp(true), RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  if (address) return <>{children}</>;

  if (pending && !gaveUp) {
    return (
      <div className="rounded-2xl border border-base-300 bg-base-100 p-10 text-center">
        <div className="mx-auto h-6 w-48 animate-pulse rounded bg-base-200" aria-hidden />
        <p className="mt-3 mb-0 text-sm text-base-content/60">Reconnecting your wallet…</p>
      </div>
    );
  }

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
};
