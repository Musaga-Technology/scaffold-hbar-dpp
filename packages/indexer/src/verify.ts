/**
 * Replay-and-compare verification.
 *
 * This is the check Hedera's own HCS guidance describes: write state
 * transitions, rebuild state from the mirror node, and compare. If the live
 * index disagrees with a clean rebuild, the index is wrong — the mirror node is
 * the authority — and this reports exactly which rows differ.
 *
 * It is the strongest claim this template makes: not "trust the database", but
 * "here is the command that proves the database matches the ledger".
 */
import { pollOnce } from "./poller.js";
import { reconcileAll } from "./reconcile.js";
import { createMemoryStore } from "./store/index.js";
import type { EventRow, IndexStore, ProductRow } from "./store/index.js";
import type { MirrorNodeClient } from "./mirror.js";

/** One disagreement between the live index and a clean replay. */
export interface Mismatch {
  kind: "event" | "product";
  key: string;
  field: string;
  live: unknown;
  replayed: unknown;
}

/** The result of a verification run. */
export interface VerifyReport {
  liveEvents: number;
  replayedEvents: number;
  liveProducts: number;
  replayedProducts: number;
  mismatches: Mismatch[];
  /** Serials the replay judged to carry a discrepancy. */
  discrepancies: number[];
  ok: boolean;
}

/** Fields compared on events. `id` is a local autoincrement and is excluded. */
const EVENT_FIELDS: Array<keyof EventRow> = [
  "consensusTimestamp",
  "serial",
  "tokenId",
  "type",
  "actor",
  "payloadJson",
  "payloadHash",
  "ref",
  "hashValid",
  "malformedReason",
  "rawHash",
  "reconciliation",
];

/** Fields compared on products. `lastReconciledAt` is a wall clock and is excluded. */
const PRODUCT_FIELDS: Array<keyof ProductRow> = ["tokenId", "topicId", "category", "name", "currentHolder", "status"];

function diffRows<T>(
  kind: Mismatch["kind"],
  fields: Array<keyof T>,
  live: Map<string, T>,
  replayed: Map<string, T>,
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  for (const [key, replayedRow] of replayed) {
    const liveRow = live.get(key);
    if (!liveRow) {
      mismatches.push({ kind, key, field: "*", live: "missing", replayed: "present" });
      continue;
    }
    for (const field of fields) {
      if (liveRow[field] !== replayedRow[field]) {
        mismatches.push({
          kind,
          key,
          field: String(field),
          live: liveRow[field],
          replayed: replayedRow[field],
        });
      }
    }
  }

  for (const key of live.keys()) {
    if (!replayed.has(key)) {
      // A row the ledger does not justify. This is the serious direction: it
      // means the index holds something the mirror node cannot account for.
      mismatches.push({ kind, key, field: "*", live: "present", replayed: "missing" });
    }
  }

  return mismatches;
}

/**
 * Rebuilds the index from the mirror node and diffs it against the live index.
 *
 * @param live The index as `indexer:dev` has been maintaining it.
 * @param mirror Mirror node client.
 * @param topicIds Topics to replay.
 * @returns A report; `ok` is false when anything differs.
 */
export async function verifyAgainstReplay(
  live: IndexStore,
  mirror: MirrorNodeClient,
  topicIds: readonly string[],
): Promise<VerifyReport> {
  const replay = await createMemoryStore();

  try {
    await pollOnce(replay, mirror, topicIds);
    await reconcileAll(replay, mirror);

    const liveEvents = await live.listAllEvents();
    const replayedEvents = await replay.listAllEvents();
    const liveProducts = await live.listProducts();
    const replayedProducts = await replay.listProducts();

    const eventKey = (row: EventRow) => `${row.topicId}#${row.sequenceNumber}`;
    const productKey = (row: ProductRow) => String(row.serial);

    const mismatches = [
      ...diffRows<EventRow>(
        "event",
        EVENT_FIELDS,
        new Map(liveEvents.map(row => [eventKey(row), row])),
        new Map(replayedEvents.map(row => [eventKey(row), row])),
      ),
      ...diffRows<ProductRow>(
        "product",
        PRODUCT_FIELDS,
        new Map(liveProducts.map(row => [productKey(row), row])),
        new Map(replayedProducts.map(row => [productKey(row), row])),
      ),
    ];

    return {
      liveEvents: liveEvents.length,
      replayedEvents: replayedEvents.length,
      liveProducts: liveProducts.length,
      replayedProducts: replayedProducts.length,
      mismatches,
      discrepancies: replayedProducts.filter(p => p.status === "discrepancy").map(p => p.serial),
      ok: mismatches.length === 0,
    };
  } finally {
    await replay.close();
  }
}

/**
 * Renders a verification report for the terminal.
 *
 * @param report Report to render.
 * @returns Human-readable text.
 */
export function formatVerifyReport(report: VerifyReport): string {
  const lines: string[] = [
    "Replay-and-compare",
    "------------------",
    `  events    live ${report.liveEvents}  replayed ${report.replayedEvents}`,
    `  products  live ${report.liveProducts}  replayed ${report.replayedProducts}`,
    "",
  ];

  if (report.ok) {
    lines.push("The live index matches a clean rebuild from the mirror node.");
  } else {
    lines.push(`${report.mismatches.length} mismatch(es) — the live index does not match the ledger:`);
    lines.push("");
    lines.push("  kind     key                    field                live -> replayed");
    for (const mismatch of report.mismatches.slice(0, 50)) {
      lines.push(
        `  ${mismatch.kind.padEnd(8)} ${mismatch.key.padEnd(22)} ${mismatch.field.padEnd(20)} ` +
          `${String(mismatch.live)} -> ${String(mismatch.replayed)}`,
      );
    }
    if (report.mismatches.length > 50) {
      lines.push(`  … and ${report.mismatches.length - 50} more`);
    }
    lines.push("");
    lines.push("Run `yarn indexer:replay` to rebuild the index from the mirror node.");
  }

  if (report.discrepancies.length > 0) {
    lines.push("");
    lines.push(`Reconciliation found custody discrepancies on serial(s): ${report.discrepancies.join(", ")}.`);
    lines.push("These are findings about the data, not faults in the index — the passport pages show them.");
  }

  return lines.join("\n");
}
