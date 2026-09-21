/**
 * Chunked topic message reassembly.
 *
 * This template forbids submitting messages over 1024 bytes, so it never creates
 * chunks. It still decodes them, because a topic is public: anything can write
 * to it, and an indexer that silently dropped chunked messages would present an
 * incomplete history as if it were complete.
 */

/** Mirror node chunk metadata. */
export interface ChunkInfo {
  initial_transaction_id?: { transaction_valid_start?: string; account_id?: string; nonce?: number } | string;
  number: number;
  total: number;
}

/** A topic message as returned by `/api/v1/topics/{id}/messages`. */
export interface MirrorTopicMessage {
  consensus_timestamp: string;
  message: string;
  sequence_number: number;
  topic_id: string;
  payer_account_id?: string;
  running_hash?: string;
  chunk_info?: ChunkInfo | null;
}

/** A message body ready to decode, with the position it occupied on the topic. */
export interface AssembledMessage {
  /** Decoded UTF-8 body. */
  raw: string;
  /** Sequence number of the final chunk, which is where the message completes. */
  sequenceNumber: number;
  /** Consensus timestamp of the final chunk. */
  consensusTimestamp: string;
  topicId: string;
  payerAccountId?: string;
  /** Number of chunks this message arrived in; 1 for ordinary messages. */
  chunkCount: number;
}

/** Stable key identifying the transaction a chunk set belongs to. */
function chunkKey(info: ChunkInfo): string {
  const id = info.initial_transaction_id;
  if (typeof id === "string") return id;
  if (id && typeof id === "object") {
    return `${id.account_id ?? "?"}@${id.transaction_valid_start ?? "?"}#${id.nonce ?? 0}`;
  }
  return "unknown";
}

/**
 * Turns raw mirror node messages into complete message bodies.
 *
 * Single-part messages pass straight through. Chunked messages are grouped by
 * their initial transaction, ordered by chunk number and concatenated. An
 * incomplete chunk set — a page boundary, or a submitter that gave up halfway —
 * is reported separately rather than being decoded as a truncated message.
 *
 * @param messages Messages in the order the mirror node returned them.
 * @returns Complete messages, and the keys of any chunk sets still missing parts.
 */
export function reassemble(messages: readonly MirrorTopicMessage[]): {
  complete: AssembledMessage[];
  incompleteKeys: string[];
} {
  const complete: AssembledMessage[] = [];
  const pending = new Map<string, MirrorTopicMessage[]>();

  for (const message of messages) {
    const info = message.chunk_info;
    if (!info || info.total <= 1) {
      complete.push({
        raw: Buffer.from(message.message, "base64").toString("utf8"),
        sequenceNumber: message.sequence_number,
        consensusTimestamp: message.consensus_timestamp,
        topicId: message.topic_id,
        payerAccountId: message.payer_account_id,
        chunkCount: 1,
      });
      continue;
    }

    const key = chunkKey(info);
    const group = pending.get(key) ?? [];
    group.push(message);
    pending.set(key, group);

    if (group.length === info.total) {
      const ordered = [...group].sort((a, b) => (a.chunk_info!.number ?? 0) - (b.chunk_info!.number ?? 0));
      const last = ordered[ordered.length - 1]!;
      complete.push({
        raw: Buffer.concat(ordered.map(part => Buffer.from(part.message, "base64"))).toString("utf8"),
        sequenceNumber: last.sequence_number,
        consensusTimestamp: last.consensus_timestamp,
        topicId: last.topic_id,
        payerAccountId: last.payer_account_id,
        chunkCount: ordered.length,
      });
      pending.delete(key);
    }
  }

  return { complete, incompleteKeys: [...pending.keys()] };
}
