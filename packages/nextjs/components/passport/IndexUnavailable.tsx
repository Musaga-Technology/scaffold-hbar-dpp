import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

/**
 * Shown when the app is pointed at an index API that is not answering.
 *
 * This state exists because the alternative is worse. Falling back to demo
 * fixtures here would show someone their *own* registry as if it contained a
 * battery they never registered — everything would look like it worked, and the
 * product they actually created would be invisible. That is exactly the
 * confusion this page exists to prevent, so it states the problem and the one
 * command that fixes it.
 */
export const IndexUnavailable = ({ url, detail }: { url: string; detail?: string }) => (
  <div className="mx-auto w-full max-w-2xl px-5 py-16" data-testid="index-unavailable">
    <div className="rounded-2xl border border-warning bg-warning/5 p-8">
      <div className="mb-3 flex items-center gap-2 text-warning">
        <ExclamationTriangleIcon className="h-6 w-6" />
        <h1 className="m-0 text-xl font-bold">The indexer is not running</h1>
      </div>

      <p className="mb-4 text-base-content/80">
        This app is configured to read from an index at <code className="rounded bg-base-300/50 px-1">{url}</code>, and
        nothing is answering there. Your passports are safe — the index is a cache of what is already on Hedera, and it
        rebuilds from the mirror node.
      </p>

      <p className="mb-2 font-semibold">Start it:</p>
      <pre className="mb-4 overflow-x-auto rounded-lg bg-base-300/40 p-3 text-sm">
        <code>yarn indexer:dev</code>
      </pre>

      <p className="mb-0 text-sm text-base-content/70">
        To go back to the bundled demo instead, remove{" "}
        <code className="rounded bg-base-300/50 px-1">INDEX_API_URL</code> from{" "}
        <code className="rounded bg-base-300/50 px-1">packages/nextjs/.env.local</code>. Showing you demo data while a
        real registry is configured would hide your own products, so this page does not do that.
      </p>

      {detail && <p className="mt-4 mb-0 font-mono text-xs text-base-content/50">{detail}</p>}
    </div>
  </div>
);
