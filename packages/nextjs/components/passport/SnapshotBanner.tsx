import { CheckBadgeIcon } from "@heroicons/react/24/outline";

/**
 * Says that this bundled passport is a copy of a real one.
 *
 * Every id on the page is real, so the HashScan and IPFS links resolve. What is
 * not live is the verdict: it is the indexer's as of the snapshot, and running
 * the indexer is how to get a current one.
 */
export const SnapshotBanner = ({ takenAt }: { takenAt: string }) => (
  <div className="alert alert-success mb-6" data-testid="snapshot-banner">
    <CheckBadgeIcon className="h-5 w-5 shrink-0" />
    <span>
      <strong>A real passport on Hedera testnet.</strong> This is a snapshot, taken {takenAt}, of a product registered
      and handed over through the issuer page. Every id is real, so each HashScan and IPFS link below opens the actual
      record. Run <code className="rounded bg-base-300/50 px-1">yarn indexer:dev</code> to check it live.
    </span>
  </div>
);
