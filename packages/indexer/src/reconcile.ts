/**
 * Custody reconciliation.
 *
 * HCS carries *claims*: someone said a product changed hands at a moment in
 * time. The NFT's transfer history on the mirror node carries what the network
 * actually recorded. This module compares the two and labels every custody claim
 * `reconciled`, `discrepancy` or `pending`.
 *
 * Three rules shape the code below, and all three are about honesty:
 *
 *  1. A claim that contradicts the chain is a **discrepancy**, surfaced with a
 *     note. It is never quietly dropped and never overwritten by the chain's
 *     version, because the fact that someone claimed it is itself evidence.
 *  2. A claim that cannot be *compared* is **pending**, not reconciled and not a
 *     discrepancy. Saying "verified" about something unverified is the worst
 *     failure this template could have.
 *  3. Custody shown to a user always comes from the mirror node, never from the
 *     claim log.
 */
import type { EventRow, EventVerdict, IndexStore, NftTransferRow, ProductStatus } from "./store/index.js";
import type { MirrorNodeClient } from "./mirror.js";

/** How far a claim's consensus time may sit from its transfer and still match. */
export const MATCH_WINDOW_SECONDS = 600;

/** Event types that assert something about custody and therefore need checking. */
const CUSTODY_EVENT_TYPES = new Set(["custody.transferred", "product.registered"]);

/** Parses a `seconds.nanos` consensus timestamp into seconds. */
function toSeconds(consensusTimestamp: string): number {
  const seconds = Number.parseFloat(consensusTimestamp);
  return Number.isFinite(seconds) ? seconds : Number.NaN;
}

/** True when a value looks like a Hedera account id the mirror node would report. */
function isAccountId(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

/** Reads the from/to pair a custody claim asserts. */
function claimedParties(event: EventRow): { from?: unknown; to?: unknown } {
  if (!event.payloadJson) return {};
  try {
    const payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
    return { from: payload.from, to: payload.to };
  } catch {
    return {};
  }
}

/** The outcome of reconciling one passport. */
export interface SerialReconciliation {
  verdicts: EventVerdict[];
  status: ProductStatus;
  /** Holder according to the mirror node, not according to HCS. */
  currentHolder?: string;
}

/**
 * Reconciles one passport's claims against its on-chain transfer history.
 *
 * Pure: it is handed the rows and returns verdicts, so the decision logic is
 * tested directly without a network or a database.
 *
 * @param events Every event recorded for the serial, in consensus order.
 * @param transfers Every NFT transfer recorded for the serial, in consensus order.
 * @returns Per-event verdicts plus the passport's overall status and holder.
 */
export function reconcileSerial(
  events: readonly EventRow[],
  transfers: readonly NftTransferRow[],
): SerialReconciliation {
  const verdicts: EventVerdict[] = [];

  for (const event of events) {
    const base = { topicId: event.topicId, sequenceNumber: event.sequenceNumber };

    // A payload that no longer hashes to its claimed digest has been altered
    // since it was written. That outranks every other check.
    if (!event.hashValid) {
      verdicts.push({
        ...base,
        reconciliation: "discrepancy",
        note: "Payload does not match the payloadHash recorded on HCS — it was altered after submission.",
      });
      continue;
    }

    if (event.malformedReason) {
      verdicts.push({
        ...base,
        reconciliation: "n/a",
        note: `Message could not be decoded (${event.malformedReason}).`,
      });
      continue;
    }

    if (!CUSTODY_EVENT_TYPES.has(event.type)) {
      verdicts.push({ ...base, reconciliation: "n/a" });
      continue;
    }

    // A mint is corroborated by the mint transfer.
    if (event.type === "product.registered") {
      const mint = transfers.find(transfer => transfer.isMint);
      verdicts.push(
        mint
          ? {
              ...base,
              reconciliation: "reconciled",
              note: `Mint confirmed on-chain at ${mint.consensusTimestamp}.`,
            }
          : {
              ...base,
              reconciliation: "pending",
              note: "No mint transfer found yet — the mirror node may still be catching up.",
            },
      );
      continue;
    }

    // Strongest signal: the claim names the transaction that carried it.
    if (event.ref) {
      const byRef = transfers.find(transfer => transfer.transactionId === event.ref);
      if (byRef) {
        verdicts.push({
          ...base,
          reconciliation: "reconciled",
          note: `Matched NFT transfer ${byRef.transactionId}.`,
        });
        continue;
      }
    }

    const { from, to } = claimedParties(event);
    if (!isAccountId(from) || !isAccountId(to)) {
      // Cannot be compared — say so rather than guessing in either direction.
      verdicts.push({
        ...base,
        reconciliation: "pending",
        note:
          "Custody claim does not name both parties as Hedera account ids, so it cannot be compared " +
          "against the NFT transfer record.",
      });
      continue;
    }

    const eventSeconds = toSeconds(event.consensusTimestamp);
    const match = transfers.find(transfer => {
      if (transfer.sender !== from || transfer.receiver !== to) return false;
      const transferSeconds = toSeconds(transfer.consensusTimestamp);
      if (!Number.isFinite(eventSeconds) || !Number.isFinite(transferSeconds)) return false;
      return Math.abs(transferSeconds - eventSeconds) <= MATCH_WINDOW_SECONDS;
    });

    verdicts.push(
      match
        ? {
            ...base,
            reconciliation: "reconciled",
            note: `Matched NFT transfer ${match.transactionId ?? match.consensusTimestamp}.`,
          }
        : {
            ...base,
            reconciliation: "discrepancy",
            note:
              `HCS claims custody moved ${from} -> ${to}, but no matching NFT transfer exists ` +
              `within ${MATCH_WINDOW_SECONDS / 60} minutes of that consensus time.`,
          },
    );
  }

  // The passport is only as trustworthy as its weakest claim.
  const hasDiscrepancy = verdicts.some(verdict => verdict.reconciliation === "discrepancy");
  const hasPending = verdicts.some(verdict => verdict.reconciliation === "pending");
  const status: ProductStatus = hasDiscrepancy ? "discrepancy" : hasPending ? "pending" : "verified";

  // Custody shown to a user comes from the chain, never from the claim log.
  const lastTransfer = transfers[transfers.length - 1];

  return { verdicts, status, currentHolder: lastTransfer?.receiver ?? undefined };
}

/**
 * Reconciles every product in the index, fetching transfer history as needed.
 *
 * @param store Index to read and update.
 * @param mirror Mirror node client.
 * @returns One summary line per serial.
 */
export async function reconcileAll(
  store: IndexStore,
  mirror: MirrorNodeClient,
): Promise<Array<{ serial: number; status: ProductStatus; discrepancies: number }>> {
  const products = await store.listProducts();
  const summaries: Array<{ serial: number; status: ProductStatus; discrepancies: number }> = [];

  for (const product of products) {
    // Refresh custody truth before judging the claims against it.
    const transactions = await mirror.fetchNftTransactions(product.tokenId, product.serial);
    for (const transaction of transactions) {
      await store.upsertTransfer({
        tokenId: product.tokenId,
        serial: product.serial,
        consensusTimestamp: transaction.consensus_timestamp,
        sender: transaction.sender_account_id ?? null,
        receiver: transaction.receiver_account_id ?? null,
        transactionId: transaction.transaction_id ?? null,
        isMint: (transaction.type ?? "").toUpperCase() === "TOKENMINT" || !transaction.sender_account_id,
      });
    }

    const events = await store.listEvents(product.serial);
    const transfers = await store.listTransfers(product.tokenId, product.serial);
    const { verdicts, status, currentHolder } = reconcileSerial(events, transfers);

    await store.recordVerdicts(verdicts);

    // A document that has been swapped since it was attested is exactly as
    // serious as a forged custody claim, and is treated the same way. An
    // unreachable one is not: a gateway outage is not evidence of fraud, and
    // downgrading a passport for it would be crying wolf.
    const attachments = await store.listAttachments(product.serial);
    const swapped = attachments.filter(attachment => attachment.state === "mismatch").length;
    const finalStatus = swapped > 0 ? "discrepancy" : status;

    await store.setProductStatus(product.serial, finalStatus, currentHolder);

    summaries.push({
      serial: product.serial,
      status: finalStatus,
      discrepancies: verdicts.filter(verdict => verdict.reconciliation === "discrepancy").length + swapped,
    });
  }

  return summaries;
}
