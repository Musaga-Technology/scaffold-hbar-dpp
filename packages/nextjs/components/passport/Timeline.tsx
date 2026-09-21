import Link from "next/link";
import { EventTypeIcon, eventLabel } from "./EventTypeIcon";
import { ArrowTopRightOnSquareIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { eventLink, formatConsensusTime, hashscan, shortActor } from "~~/lib/hashscan";
import type { PassportEventRow } from "~~/lib/indexClient";

/**
 * Renders a payload as a short, readable summary.
 *
 * Deliberately generic rather than per-category: a category schema this app has
 * never seen should still render something truthful instead of an empty row.
 */
function summarise(payload: Record<string, unknown> | null): string | undefined {
  if (!payload) return undefined;

  const parts = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .filter(([, value]) => typeof value !== "object")
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${String(value)}`);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

const RowLink = ({ href, demo, children }: { href: string; demo?: boolean; children: React.ReactNode }) => (
  <Link
    href={href}
    target="_blank"
    rel="noreferrer"
    // In demo mode the ids are illustrative and will not resolve. The link is
    // still rendered so the shape of a real passport is visible, but it says so
    // rather than letting someone click into an unexplained 404.
    title={
      demo ? "Demo data — this id is not a real entity on Hedera testnet, so HashScan will not find it" : undefined
    }
    className={`link link-hover inline-flex items-center gap-1 text-xs ${
      demo ? "text-base-content/40 decoration-dotted" : "text-base-content/60 hover:text-primary"
    }`}
  >
    {children}
    {demo && <span className="opacity-70">(demo id)</span>}
    <ArrowTopRightOnSquareIcon className="h-3 w-3" />
  </Link>
);

/**
 * The ordered lifecycle of one passport.
 *
 * Every entry carries a link back to HashScan, so nothing here has to be taken
 * on this app's word. Entries the indexer could not reconcile are visibly
 * flagged with the reason rather than being quietly dropped or softened.
 */
export const Timeline = ({
  events,
  tokenId,
  serial,
  demo = false,
}: {
  events: PassportEventRow[];
  tokenId: string;
  serial: number;
  /** True when the rows come from bundled fixtures, so ids do not resolve. */
  demo?: boolean;
}) => {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-base-300 bg-base-100 p-6 text-center text-base-content/60">
        No events indexed for this passport yet.
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-3 list-none pl-0" data-testid="timeline">
      {events.map(event => {
        const isDiscrepancy = event.reconciliation === "discrepancy";
        const isMalformed = Boolean(event.malformedReason);
        const link = eventLink(event.topicId, event.ref);
        const summary = summarise(event.payload);

        return (
          <li
            key={`${event.topicId}-${event.sequenceNumber}`}
            className={`rounded-xl border p-4 ${
              isDiscrepancy ? "border-error bg-error/5" : "border-base-300 bg-base-100"
            }`}
            data-testid="timeline-entry"
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  isDiscrepancy ? "bg-error/15 text-error" : "bg-primary/10 text-primary"
                }`}
              >
                <EventTypeIcon type={event.type} />
              </div>

              <div className="min-w-0 grow">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold">{eventLabel(event.type)}</span>
                  <span className="text-xs text-base-content/60">by {shortActor(event.actor)}</span>
                  {event.reconciliation === "reconciled" && (
                    <span className="badge badge-success badge-xs">matched on-chain</span>
                  )}
                  {event.reconciliation === "pending" && (
                    <span className="badge badge-warning badge-xs">unchecked</span>
                  )}
                  {!event.hashValid && !isMalformed && (
                    <span className="badge badge-error badge-xs">payload altered</span>
                  )}
                </div>

                <div className="mt-0.5 text-xs text-base-content/60">
                  {formatConsensusTime(event.consensusTimestamp)} · sequence {event.sequenceNumber}
                </div>

                {summary && <p className="mt-2 mb-0 text-sm text-base-content/80 break-words">{summary}</p>}

                {(isDiscrepancy || isMalformed) && event.reconciliationNote && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-error/10 p-2 text-sm text-error">
                    <ExclamationTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{event.reconciliationNote}</span>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-3">
                  <RowLink href={link.href} demo={demo}>
                    {link.label} on HashScan
                  </RowLink>
                  {event.type === "custody.transferred" && (
                    <RowLink href={hashscan.serial(tokenId, serial)} demo={demo}>
                      NFT serial
                    </RowLink>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
};
