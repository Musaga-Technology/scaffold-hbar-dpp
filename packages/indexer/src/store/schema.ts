/**
 * Index schema.
 *
 * This database is a *derived* artifact. Every row in it can be rebuilt from the
 * mirror node by `yarn indexer:replay`, and `yarn indexer:verify` proves it by
 * replaying into a fresh database and diffing. Nothing here is a source of
 * truth — which is exactly why it is safe to drop and rebuild it.
 */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Overall verification verdict for a passport. */
export const PRODUCT_STATUSES = ["verified", "pending", "discrepancy"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Per-event reconciliation outcome. */
export const RECONCILIATION_STATES = ["n/a", "reconciled", "discrepancy", "pending"] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

/**
 * One row per product passport.
 *
 * `currentHolder` and `status` come from the mirror node, not from HCS: HCS
 * carries claims, the NFT record carries what actually happened.
 */
export const products = sqliteTable(
  "products",
  {
    serial: integer("serial").primaryKey(),
    tokenId: text("token_id").notNull(),
    topicId: text("topic_id").notNull(),
    productHash: text("product_hash"),
    issuer: text("issuer"),
    category: text("category"),
    name: text("name"),
    /** Full registration payload as canonical JSON, for rendering. */
    metadataJson: text("metadata_json"),
    /** Holder according to the mirror node's NFT record. */
    currentHolder: text("current_holder"),
    status: text("status").$type<ProductStatus>().notNull().default("pending"),
    lastReconciledAt: text("last_reconciled_at"),
  },
  table => [index("products_token_idx").on(table.tokenId), index("products_topic_idx").on(table.topicId)],
);

/**
 * One row per decoded topic message.
 *
 * Keyed by (topicId, sequenceNumber) because that pair is what the mirror node
 * guarantees to be stable and unique. Re-polling the same range therefore
 * updates rows in place rather than duplicating them, which is what makes the
 * poller safe to restart at any point.
 */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: text("topic_id").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    consensusTimestamp: text("consensus_timestamp").notNull(),
    serial: integer("serial"),
    tokenId: text("token_id"),
    type: text("type").notNull(),
    actor: text("actor"),
    payloadJson: text("payload_json"),
    payloadHash: text("payload_hash"),
    ref: text("ref"),
    /** False when the payload no longer hashes to its claimed payloadHash. */
    hashValid: integer("hash_valid", { mode: "boolean" }).notNull().default(true),
    /** Set when the message could not be decoded at all. */
    malformedReason: text("malformed_reason"),
    /** sha256 of the raw bytes, so even an unreadable message stays anchored. */
    rawHash: text("raw_hash"),
    reconciliation: text("reconciliation").$type<ReconciliationState>().notNull().default("n/a"),
    reconciliationNote: text("reconciliation_note"),
  },
  table => [
    uniqueIndex("events_topic_sequence_idx").on(table.topicId, table.sequenceNumber),
    index("events_serial_idx").on(table.serial),
    index("events_consensus_idx").on(table.consensusTimestamp),
  ],
);

/** Poll position per topic, so a restart resumes instead of re-reading. */
export const cursors = sqliteTable("cursors", {
  topicId: text("topic_id").primaryKey(),
  lastSequenceNumber: integer("last_sequence_number").notNull().default(0),
  updatedAt: text("updated_at"),
});

/**
 * NFT transfers as reported by the mirror node.
 *
 * This is the custody truth that HCS claims are checked against.
 */
export const nftTransfers = sqliteTable(
  "nft_transfers",
  {
    tokenId: text("token_id").notNull(),
    serial: integer("serial").notNull(),
    consensusTimestamp: text("consensus_timestamp").notNull(),
    sender: text("sender"),
    receiver: text("receiver"),
    transactionId: text("transaction_id"),
    /** True for the mint, which has no sender. */
    isMint: integer("is_mint", { mode: "boolean" }).notNull().default(false),
  },
  table => [
    primaryKey({ columns: [table.tokenId, table.serial, table.consensusTimestamp] }),
    index("nft_transfers_serial_idx").on(table.tokenId, table.serial),
  ],
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type CursorRow = typeof cursors.$inferSelect;
export type NftTransferRow = typeof nftTransfers.$inferSelect;
export type NewNftTransferRow = typeof nftTransfers.$inferInsert;
