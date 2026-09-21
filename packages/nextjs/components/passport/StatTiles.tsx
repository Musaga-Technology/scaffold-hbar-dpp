import type { IndexStats } from "~~/lib/indexClient";

/**
 * Registry counts.
 *
 * Discrepancies are shown with the same prominence as everything else. A
 * provenance tool that buried its own failures would be worth less than none.
 */
export const StatTiles = ({ stats }: { stats: IndexStats }) => {
  const tiles: Array<{ label: string; value: number; tone?: string }> = [
    { label: "Passports", value: stats.products },
    { label: "Events", value: stats.events },
    { label: "Verified", value: stats.verified, tone: "text-success" },
    { label: "Pending", value: stats.pending, tone: stats.pending > 0 ? "text-warning" : undefined },
    { label: "Discrepancies", value: stats.discrepancies, tone: stats.discrepancies > 0 ? "text-error" : undefined },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map(tile => (
        <div key={tile.label} className="rounded-xl border border-base-300 bg-base-100 p-4 text-center">
          <div className={`text-2xl font-bold ${tile.tone ?? ""}`}>{tile.value}</div>
          <div className="text-xs uppercase tracking-wider text-base-content/60">{tile.label}</div>
        </div>
      ))}
    </div>
  );
};
