import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import type { ProductStatus } from "~~/lib/indexClient";

/**
 * Verification verdict for a passport.
 *
 * The three states are never collapsed into two. `pending` exists precisely so
 * the UI is not forced to choose between claiming "verified" about something it
 * has not checked and crying "discrepancy" about something merely unfinished.
 */
const PRESENTATION: Record<
  ProductStatus,
  { label: string; className: string; icon: typeof CheckCircleIcon; blurb: string }
> = {
  verified: {
    label: "Verified",
    className: "badge-success",
    icon: CheckCircleIcon,
    blurb: "Every custody claim on this passport matches the NFT's transfer history on the mirror node.",
  },
  pending: {
    label: "Pending",
    className: "badge-warning",
    icon: ClockIcon,
    blurb: "The indexer has not finished checking this passport. Nothing here is verified yet.",
  },
  discrepancy: {
    label: "Discrepancy",
    className: "badge-error",
    icon: ExclamationTriangleIcon,
    blurb: "A claim on this passport does not match what happened on-chain. The offending events are flagged below.",
  },
};

export const StatusBadge = ({ status, showBlurb = false }: { status: ProductStatus; showBlurb?: boolean }) => {
  const { label, className, icon: Icon, blurb } = PRESENTATION[status];

  return (
    <div className="flex flex-col gap-2">
      <span className={`badge ${className} gap-1.5 badge-lg font-semibold`} data-testid="status-badge">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      {showBlurb && <p className="text-sm text-base-content/70 m-0 max-w-prose">{blurb}</p>}
    </div>
  );
};
