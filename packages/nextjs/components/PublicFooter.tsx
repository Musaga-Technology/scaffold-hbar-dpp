import Link from "next/link";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { network } from "~~/lib/hashscan";

/**
 * Footer for the public pages.
 *
 * The scaffold footer reads chain state and an HBAR price feed through wagmi
 * hooks, which would drag the wallet stack back into the public bundle. This
 * one reports the network from configuration instead.
 */
export const PublicFooter = () => (
  <footer className="mt-auto border-t border-base-300 px-5 py-4">
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 text-sm text-base-content/60">
      <span>Anchored on Hedera {network()} · reads come from the index, never from HCS directly</span>
      <div className="flex items-center gap-4">
        <Link href="https://hashscan.io" target="_blank" rel="noreferrer" className="link link-hover">
          HashScan
        </Link>
        <SwitchTheme />
      </div>
    </div>
  </footer>
);
