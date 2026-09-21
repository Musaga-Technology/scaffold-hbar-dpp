/**
 * SQLite-backed index store.
 *
 * SQLite is the default because it needs no setup: `yarn indexer:dev` works on a
 * fresh clone with no services running. Set DATABASE_URL to use Postgres for a
 * long-running deployment instead.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { attachments, cursors, events, nftTransfers, products } from "./schema.js";
import type { AttachmentVerdict, EventVerdict, IndexStats, IndexStore, PassportView } from "./types.js";
import type {
  AttachmentRow,
  NewAttachmentRow,
  EventRow,
  NewEventRow,
  NewNftTransferRow,
  NewProductRow,
  NftTransferRow,
  ProductRow,
  ProductStatus,
} from "./schema.js";

/**
 * Table definitions applied on open.
 *
 * Kept as explicit DDL rather than generated migration files: the index is a
 * derived artifact that is dropped and rebuilt by `indexer:replay`, so there is
 * no user data to migrate and no history worth carrying. One fewer build step
 * between `yarn install` and a working indexer.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS products (
  serial INTEGER PRIMARY KEY,
  token_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  product_hash TEXT,
  issuer TEXT,
  category TEXT,
  name TEXT,
  metadata_json TEXT,
  current_holder TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_reconciled_at TEXT
);
CREATE INDEX IF NOT EXISTS products_token_idx ON products (token_id);
CREATE INDEX IF NOT EXISTS products_topic_idx ON products (topic_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  consensus_timestamp TEXT NOT NULL,
  serial INTEGER,
  token_id TEXT,
  type TEXT NOT NULL,
  actor TEXT,
  payload_json TEXT,
  payload_hash TEXT,
  ref TEXT,
  hash_valid INTEGER NOT NULL DEFAULT 1,
  malformed_reason TEXT,
  raw_hash TEXT,
  reconciliation TEXT NOT NULL DEFAULT 'n/a',
  reconciliation_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS events_topic_sequence_idx ON events (topic_id, sequence_number);
CREATE INDEX IF NOT EXISTS events_serial_idx ON events (serial);
CREATE INDEX IF NOT EXISTS events_consensus_idx ON events (consensus_timestamp);

CREATE TABLE IF NOT EXISTS cursors (
  topic_id TEXT PRIMARY KEY,
  last_sequence_number INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS nft_transfers (
  token_id TEXT NOT NULL,
  serial INTEGER NOT NULL,
  consensus_timestamp TEXT NOT NULL,
  sender TEXT,
  receiver TEXT,
  transaction_id TEXT,
  is_mint INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, serial, consensus_timestamp)
);
CREATE INDEX IF NOT EXISTS nft_transfers_serial_idx ON nft_transfers (token_id, serial);

CREATE TABLE IF NOT EXISTS attachments (
  topic_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  cid TEXT NOT NULL,
  declared_hash TEXT NOT NULL,
  name TEXT,
  media_type TEXT,
  observed_hash TEXT,
  bytes INTEGER,
  state TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  checked_at TEXT,
  PRIMARY KEY (topic_id, sequence_number, cid)
);
CREATE INDEX IF NOT EXISTS attachments_state_idx ON attachments (state);
`;

export class SqliteIndexStore implements IndexStore {
  private readonly sqlite: Database.Database;
  private readonly db: BetterSQLite3Database;

  /**
   * Opens (or creates) the index.
   *
   * @param filePath Path to the SQLite file, or ":memory:" for a throwaway index.
   */
  constructor(filePath: string) {
    if (filePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    }
    this.sqlite = new Database(filePath);
    // WAL keeps `indexer:dev` writing while the read API serves queries.
    if (filePath !== ":memory:") this.sqlite.pragma("journal_mode = WAL");
    this.db = drizzle(this.sqlite);
  }

  async migrate(): Promise<void> {
    this.sqlite.exec(DDL);
  }

  async upsertProduct(product: NewProductRow): Promise<void> {
    this.db
      .insert(products)
      .values(product)
      .onConflictDoUpdate({
        target: products.serial,
        // Only overwrite what the caller actually supplied, so a later partial
        // update (say, reconciliation setting the holder) cannot blank fields
        // that were learned earlier from a different source.
        set: Object.fromEntries(
          Object.entries(product).filter(([key, value]) => key !== "serial" && value !== undefined),
        ),
      })
      .run();
  }

  async getProduct(serial: number): Promise<ProductRow | undefined> {
    return this.db.select().from(products).where(eq(products.serial, serial)).get();
  }

  async listProducts(): Promise<ProductRow[]> {
    return this.db.select().from(products).orderBy(asc(products.serial)).all();
  }

  async setProductStatus(serial: number, status: ProductStatus, currentHolder?: string): Promise<void> {
    this.db
      .update(products)
      .set({
        status,
        ...(currentHolder === undefined ? {} : { currentHolder }),
        lastReconciledAt: new Date().toISOString(),
      })
      .where(eq(products.serial, serial))
      .run();
  }

  async upsertEvent(event: NewEventRow): Promise<void> {
    this.db
      .insert(events)
      .values(event)
      .onConflictDoUpdate({
        target: [events.topicId, events.sequenceNumber],
        set: Object.fromEntries(Object.entries(event).filter(([key, value]) => key !== "id" && value !== undefined)),
      })
      .run();
  }

  async listEvents(serial: number): Promise<EventRow[]> {
    return this.db
      .select()
      .from(events)
      .where(eq(events.serial, serial))
      .orderBy(asc(events.consensusTimestamp), asc(events.sequenceNumber))
      .all();
  }

  async listEventsByTopic(topicId: string): Promise<EventRow[]> {
    return this.db.select().from(events).where(eq(events.topicId, topicId)).orderBy(asc(events.sequenceNumber)).all();
  }

  async listAllEvents(): Promise<EventRow[]> {
    return this.db.select().from(events).orderBy(asc(events.topicId), asc(events.sequenceNumber)).all();
  }

  async recordVerdicts(verdicts: readonly EventVerdict[]): Promise<void> {
    if (verdicts.length === 0) return;
    this.sqlite.transaction(() => {
      for (const verdict of verdicts) {
        this.db
          .update(events)
          .set({ reconciliation: verdict.reconciliation, reconciliationNote: verdict.note ?? null })
          .where(and(eq(events.topicId, verdict.topicId), eq(events.sequenceNumber, verdict.sequenceNumber)))
          .run();
      }
    })();
  }

  async upsertTransfer(transfer: NewNftTransferRow): Promise<void> {
    this.db
      .insert(nftTransfers)
      .values(transfer)
      .onConflictDoUpdate({
        target: [nftTransfers.tokenId, nftTransfers.serial, nftTransfers.consensusTimestamp],
        set: Object.fromEntries(Object.entries(transfer).filter(([, value]) => value !== undefined)),
      })
      .run();
  }

  async listTransfers(tokenId: string, serial: number): Promise<NftTransferRow[]> {
    return this.db
      .select()
      .from(nftTransfers)
      .where(and(eq(nftTransfers.tokenId, tokenId), eq(nftTransfers.serial, serial)))
      .orderBy(asc(nftTransfers.consensusTimestamp))
      .all();
  }

  async upsertAttachment(attachment: NewAttachmentRow): Promise<void> {
    this.db
      .insert(attachments)
      .values(attachment)
      .onConflictDoUpdate({
        target: [attachments.topicId, attachments.sequenceNumber, attachments.cid],
        // A re-poll re-declares the reference but must not discard a verdict the
        // verifier already reached, so only the declared fields are refreshed.
        set: Object.fromEntries(
          Object.entries(attachment).filter(
            ([key, value]) => value !== undefined && !["state", "note", "observedHash", "checkedAt"].includes(key),
          ),
        ),
      })
      .run();
  }

  async listAttachments(serial: number): Promise<AttachmentRow[]> {
    const rows = this.db
      .select({ attachment: attachments })
      .from(attachments)
      .innerJoin(
        events,
        and(eq(events.topicId, attachments.topicId), eq(events.sequenceNumber, attachments.sequenceNumber)),
      )
      .where(eq(events.serial, serial))
      .orderBy(asc(attachments.sequenceNumber), asc(attachments.cid))
      .all();
    return rows.map(row => row.attachment);
  }

  async listAttachmentsByEvent(topicId: string, sequenceNumber: number): Promise<AttachmentRow[]> {
    return this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.topicId, topicId), eq(attachments.sequenceNumber, sequenceNumber)))
      .orderBy(asc(attachments.cid))
      .all();
  }

  async listAllAttachments(): Promise<AttachmentRow[]> {
    return this.db
      .select()
      .from(attachments)
      .orderBy(asc(attachments.topicId), asc(attachments.sequenceNumber), asc(attachments.cid))
      .all();
  }

  async recordAttachmentVerdicts(verdicts: readonly AttachmentVerdict[]): Promise<void> {
    if (verdicts.length === 0) return;
    const checkedAt = new Date().toISOString();
    this.sqlite.transaction(() => {
      for (const verdict of verdicts) {
        this.db
          .update(attachments)
          .set({
            state: verdict.state,
            observedHash: verdict.observedHash ?? null,
            bytes: verdict.bytes ?? null,
            note: verdict.note ?? null,
            checkedAt,
          })
          .where(
            and(
              eq(attachments.topicId, verdict.topicId),
              eq(attachments.sequenceNumber, verdict.sequenceNumber),
              eq(attachments.cid, verdict.cid),
            ),
          )
          .run();
      }
    })();
  }

  async getCursor(topicId: string): Promise<number> {
    const row = this.db.select().from(cursors).where(eq(cursors.topicId, topicId)).get();
    return row?.lastSequenceNumber ?? 0;
  }

  async setCursor(topicId: string, lastSequenceNumber: number): Promise<void> {
    this.db
      .insert(cursors)
      .values({ topicId, lastSequenceNumber, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: cursors.topicId,
        set: { lastSequenceNumber, updatedAt: new Date().toISOString() },
      })
      .run();
  }

  async listCursors(): Promise<Array<{ topicId: string; lastSequenceNumber: number }>> {
    return this.db
      .select({ topicId: cursors.topicId, lastSequenceNumber: cursors.lastSequenceNumber })
      .from(cursors)
      .orderBy(asc(cursors.topicId))
      .all();
  }

  async getPassport(serial: number): Promise<PassportView | undefined> {
    const product = await this.getProduct(serial);
    if (!product) return undefined;
    return {
      product,
      events: await this.listEvents(serial),
      transfers: await this.listTransfers(product.tokenId, serial),
      attachments: await this.listAttachments(serial),
    };
  }

  async stats(): Promise<IndexStats> {
    const countOf = (table: typeof products | typeof events, where?: ReturnType<typeof eq>) => {
      const query = this.db.select({ value: sql<number>`count(*)` }).from(table);
      return (where ? query.where(where) : query).get()?.value ?? 0;
    };

    const attachmentCount = (where?: ReturnType<typeof eq>) => {
      const query = this.db.select({ value: sql<number>`count(*)` }).from(attachments);
      return (where ? query.where(where) : query).get()?.value ?? 0;
    };

    return {
      products: countOf(products),
      events: countOf(events),
      attachments: attachmentCount(),
      attachmentsVerified: attachmentCount(eq(attachments.state, "verified")),
      // A document that cannot be fetched is as much a finding as one that has
      // been swapped: either way the passport cannot back its own claim.
      attachmentsFailed:
        attachmentCount(eq(attachments.state, "mismatch")) + attachmentCount(eq(attachments.state, "unreachable")),
      verified: countOf(products, eq(products.status, "verified")),
      pending: countOf(products, eq(products.status, "pending")),
      discrepancies: countOf(products, eq(products.status, "discrepancy")),
      topics:
        this.db
          .select({ value: sql<number>`count(distinct topic_id)` })
          .from(products)
          .get()?.value ?? 0,
    };
  }

  async reset(): Promise<void> {
    this.sqlite.exec(`
      DELETE FROM events;
      DELETE FROM products;
      DELETE FROM cursors;
      DELETE FROM nft_transfers;
      DELETE FROM attachments;
    `);
  }

  async close(): Promise<void> {
    this.sqlite.close();
  }
}

/**
 * Opens the index described by the config.
 *
 * @param dbPath SQLite file path, or ":memory:".
 * @returns A migrated, ready-to-use store.
 */
export async function openSqliteStore(dbPath: string): Promise<IndexStore> {
  const store = new SqliteIndexStore(dbPath);
  await store.migrate();
  return store;
}
