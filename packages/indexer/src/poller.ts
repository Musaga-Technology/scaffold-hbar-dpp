/**
 * Mirror node poller.
 *
 * Reads each product topic from its cursor forward, decodes what it finds and
 * writes it to the index. Every write is keyed by (topicId, sequenceNumber), so
 * polling the same range twice is a no-op — which is what makes the poller safe
 * to kill and restart, and what makes `indexer:replay` produce the same database
 * as an incremental run.
 */
import { canonicalize, decodeBase64Event, reassemble, type MirrorTopicMessage } from "./events/index.js";
import { recordAttachments } from "./attachments.js";
import type { MirrorNodeClient } from "./mirror.js";
import type { IndexStore, NewEventRow } from "./store/index.js";

/** What one poll of one topic did. */
export interface PollResult {
  topicId: string;
  /** Messages examined this pass. */
  read: number;
  /** Messages written to the index. */
  written: number;
  /** Messages that could not be decoded. */
  malformed: number;
  /** Cursor after the pass. */
  cursor: number;
  /** Chunk sets still waiting for parts, carried to the next pass. */
  incomplete: number;
  /** Attachment references recorded this pass. */
  attachments: number;
}

/** Fields worth lifting out of a `product.registered` payload into the product row. */
interface RegistrationFacts {
  category?: string;
  name?: string;
  metadataJson?: string;
}

function readRegistration(payload: Record<string, unknown>): RegistrationFacts {
  return {
    category: typeof payload.category === "string" ? payload.category : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    metadataJson: canonicalize(payload),
  };
}

/**
 * Converts one assembled topic message into the row the index stores.
 *
 * A message that cannot be decoded still produces a row: the consensus timestamp
 * and a hash of the raw bytes are recorded, with the reason. Dropping it would
 * make the index quietly disagree with the topic.
 */
function toEventRow(
  topicId: string,
  sequenceNumber: number,
  consensusTimestamp: string,
  raw: string,
): {
  row: NewEventRow;
  registration?: { serial: number; tokenId: string; facts: RegistrationFacts };
  payload?: Record<string, unknown>;
} {
  const decoded = decodeBase64Event(Buffer.from(raw, "utf8").toString("base64"));

  if (!decoded.ok) {
    return {
      row: {
        topicId,
        sequenceNumber,
        consensusTimestamp,
        type: "malformed",
        hashValid: false,
        malformedReason: decoded.reason,
        rawHash: decoded.rawHash,
        reconciliationNote: decoded.detail,
        reconciliation: "n/a",
      },
    };
  }

  const { event, hashValid } = decoded;
  const row: NewEventRow = {
    topicId,
    sequenceNumber,
    consensusTimestamp,
    serial: event.serial,
    tokenId: event.tokenId,
    type: event.type,
    actor: event.actor,
    payloadJson: canonicalize(event.payload),
    payloadHash: event.payloadHash,
    ref: event.ref ?? null,
    hashValid,
    // Custody claims start as pending; reconciliation decides their verdict.
    reconciliation: event.type === "custody.transferred" || event.type === "product.registered" ? "pending" : "n/a",
    reconciliationNote: hashValid ? null : "Payload does not match its claimed payloadHash.",
  };

  return {
    row,
    payload: event.payload,
    registration:
      event.type === "product.registered"
        ? { serial: event.serial, tokenId: event.tokenId, facts: readRegistration(event.payload) }
        : undefined,
  };
}

/**
 * Polls one topic from its stored cursor and writes what it finds.
 *
 * @param store Index to write to.
 * @param mirror Mirror node client.
 * @param topicId Topic to poll.
 * @returns A summary of the pass.
 */
export async function pollTopic(store: IndexStore, mirror: MirrorNodeClient, topicId: string): Promise<PollResult> {
  const cursor = await store.getCursor(topicId);
  const messages: MirrorTopicMessage[] = await mirror.fetchAllTopicMessages(topicId, cursor);
  const { complete, incompleteKeys } = reassemble(messages);

  let written = 0;
  let malformed = 0;
  let attachmentsFound = 0;
  let highest = cursor;

  for (const message of complete) {
    const { row, registration, payload } = toEventRow(
      topicId,
      message.sequenceNumber,
      message.consensusTimestamp,
      message.raw,
    );

    await store.upsertEvent(row);
    written += 1;
    if (row.malformedReason) malformed += 1;

    // The reference is a fact about the log and goes in immediately. Whether
    // the document behind it is genuine takes a network round trip, and is
    // decided separately by the verification pass.
    if (payload) {
      attachmentsFound += (await recordAttachments(store, topicId, message.sequenceNumber, payload)).length;
    }

    if (registration) {
      await store.upsertProduct({
        serial: registration.serial,
        tokenId: registration.tokenId,
        topicId,
        ...registration.facts,
        issuer: row.actor ?? undefined,
        productHash: row.payloadHash ?? undefined,
      });
    }

    highest = Math.max(highest, message.sequenceNumber);
  }

  // Only advance the cursor past messages actually written. An incomplete chunk
  // set leaves the cursor behind it, so the missing parts are re-read next pass
  // instead of being skipped forever.
  if (highest > cursor && incompleteKeys.length === 0) {
    await store.setCursor(topicId, highest);
  }

  return {
    topicId,
    read: messages.length,
    written,
    malformed,
    cursor: incompleteKeys.length === 0 ? highest : cursor,
    incomplete: incompleteKeys.length,
    attachments: attachmentsFound,
  };
}

/**
 * Records the NFT transfer history for a serial.
 *
 * This is read from the mirror node's token endpoints, never from HCS: it is the
 * custody record that claims get checked against.
 */
export async function syncTransfers(
  store: IndexStore,
  mirror: MirrorNodeClient,
  tokenId: string,
  serial: number,
): Promise<number> {
  const transactions = await mirror.fetchNftTransactions(tokenId, serial);

  for (const transaction of transactions) {
    await store.upsertTransfer({
      tokenId,
      serial,
      consensusTimestamp: transaction.consensus_timestamp,
      sender: transaction.sender_account_id ?? null,
      receiver: transaction.receiver_account_id ?? null,
      transactionId: transaction.transaction_id ?? null,
      isMint: (transaction.type ?? "").toUpperCase() === "TOKENMINT" || !transaction.sender_account_id,
    });
  }

  return transactions.length;
}

/**
 * Polls every configured topic once.
 *
 * @param store Index to write to.
 * @param mirror Mirror node client.
 * @param topicIds Topics to poll.
 * @returns One result per topic.
 */
export async function pollOnce(
  store: IndexStore,
  mirror: MirrorNodeClient,
  topicIds: readonly string[],
): Promise<PollResult[]> {
  const results: PollResult[] = [];
  for (const topicId of topicIds) {
    results.push(await pollTopic(store, mirror, topicId));
  }
  return results;
}
