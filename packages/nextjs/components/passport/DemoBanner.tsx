import { InformationCircleIcon } from "@heroicons/react/24/outline";

/**
 * Says plainly that the page is showing bundled demo data.
 *
 * A provenance tool that let someone mistake sample data for a real record
 * would be failing at the one thing it exists to do, so this is never subtle
 * and never dismissible.
 */
export const DemoBanner = () => (
  <div className="alert alert-info mb-6" data-testid="demo-banner">
    <InformationCircleIcon className="h-5 w-5 shrink-0" />
    <span>
      <strong>Demo data.</strong> This passport comes from bundled fixtures, not from a live registry. Run{" "}
      <code className="rounded bg-base-300/50 px-1">yarn passport:bootstrap</code> and{" "}
      <code className="rounded bg-base-300/50 px-1">yarn indexer:dev</code> to index a real one.
    </span>
  </div>
);
