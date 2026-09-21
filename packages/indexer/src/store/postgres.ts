/**
 * Postgres-backed index store.
 *
 * Selected by setting `DATABASE_URL`. SQLite remains the zero-setup default for
 * local work; this exists for a long-running deployment where the index is
 * shared between an indexer process and one or more app instances, which a
 * SQLite file on one container's disk cannot do.
 *
 * Written against `pg` with explicit SQL rather than a second Drizzle schema.
 * The SQLite store already creates its tables from explicit DDL — the index is a
 * derived artifact that `indexer:replay` drops and rebuilds — so a second set of
 * ORM table definitions would be duplication that buys nothing but a chance for
 * the two dialects to drift apart.
 */
import { Pool } from "pg";

import type {
  EventRow,
  NewEventRow,
  NewNftTransferRow,
  NewProductRow,
  NftTransferRow,
  ProductRow,
  ProductStatus,
} from "./schema.js";
import type { EventVerdict, IndexStats, IndexStore, PassportView } from "./types.js";

const DDL = `
CREATE TABLE IF NOT EXISTS products (
  serial BIGINT PRIMARY KEY,
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
  id BIGSERIAL PRIMARY KEY,
  topic_id TEXT NOT NULL,
  sequence_number BIGINT NOT NULL,
  consensus_timestamp TEXT NOT NULL,
  serial BIGINT,
  token_id TEXT,
  type TEXT NOT NULL,
  actor TEXT,
  payload_json TEXT,
  payload_hash TEXT,
  ref TEXT,
  hash_valid BOOLEAN NOT NULL DEFAULT TRUE,
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
  last_sequence_number BIGINT NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS nft_transfers (
  token_id TEXT NOT NULL,
  serial BIGINT NOT NULL,
  consensus_timestamp TEXT NOT NULL,
  sender TEXT,
  receiver TEXT,
  transaction_id TEXT,
  is_mint BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (token_id, serial, consensus_timestamp)
);
CREATE INDEX IF NOT EXISTS nft_transfers_serial_idx ON nft_transfers (token_id, serial);
`;

/** Maps a products row from snake_case columns to the shared row type. */
function toProduct(row: Record<string, unknown>): ProductRow {
  return {
    serial: Number(row.serial),
    tokenId: row.token_id as string,
    topicId: row.topic_id as string,
    productHash: (row.product_hash as string) ?? null,
    issuer: (row.issuer as string) ?? null,
    category: (row.category as string) ?? null,
    name: (row.name as string) ?? null,
    metadataJson: (row.metadata_json as string) ?? null,
    currentHolder: (row.current_holder as string) ?? null,
    status: row.status as ProductStatus,
    lastReconciledAt: (row.last_reconciled_at as string) ?? null,
  };
}

function toEvent(row: Record<string, unknown>): EventRow {
  return {
    id: Number(row.id),
    topicId: row.topic_id as string,
    sequenceNumber: Number(row.sequence_number),
    consensusTimestamp: row.consensus_timestamp as string,
    serial: row.serial === null ? null : Number(row.serial),
    tokenId: (row.token_id as string) ?? null,
    type: row.type as string,
    actor: (row.actor as string) ?? null,
    payloadJson: (row.payload_json as string) ?? null,
    payloadHash: (row.payload_hash as string) ?? null,
    ref: (row.ref as string) ?? null,
    hashValid: Boolean(row.hash_valid),
    malformedReason: (row.malformed_reason as string) ?? null,
    rawHash: (row.raw_hash as string) ?? null,
    reconciliation: row.reconciliation as EventRow["reconciliation"],
    reconciliationNote: (row.reconciliation_note as string) ?? null,
  };
}

function toTransfer(row: Record<string, unknown>): NftTransferRow {
  return {
    tokenId: row.token_id as string,
    serial: Number(row.serial),
    consensusTimestamp: row.consensus_timestamp as string,
    sender: (row.sender as string) ?? null,
    receiver: (row.receiver as string) ?? null,
    transactionId: (row.transaction_id as string) ?? null,
    isMint: Boolean(row.is_mint),
  };
}

export class PostgresIndexStore implements IndexStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async migrate(): Promise<void> {
    await this.pool.query(DDL);
  }

  async upsertProduct(product: NewProductRow): Promise<void> {
    // Only overwrite what the caller supplied: COALESCE keeps a value learned
    // earlier from a different source when this write does not carry it.
    await this.pool.query(
      `INSERT INTO products (serial, token_id, topic_id, product_hash, issuer, category, name, metadata_json, current_holder, status, last_reconciled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'pending'),$11)
       ON CONFLICT (serial) DO UPDATE SET
         token_id = EXCLUDED.token_id,
         topic_id = EXCLUDED.topic_id,
         product_hash = COALESCE(EXCLUDED.product_hash, products.product_hash),
         issuer = COALESCE(EXCLUDED.issuer, products.issuer),
         category = COALESCE(EXCLUDED.category, products.category),
         name = COALESCE(EXCLUDED.name, products.name),
         metadata_json = COALESCE(EXCLUDED.metadata_json, products.metadata_json),
         current_holder = COALESCE(EXCLUDED.current_holder, products.current_holder),
         status = COALESCE(EXCLUDED.status, products.status),
         last_reconciled_at = COALESCE(EXCLUDED.last_reconciled_at, products.last_reconciled_at)`,
      [
        product.serial,
        product.tokenId,
        product.topicId,
        product.productHash ?? null,
        product.issuer ?? null,
        product.category ?? null,
        product.name ?? null,
        product.metadataJson ?? null,
        product.currentHolder ?? null,
        product.status ?? null,
        product.lastReconciledAt ?? null,
      ],
    );
  }

  async getProduct(serial: number): Promise<ProductRow | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM products WHERE serial = $1", [serial]);
    return rows[0] ? toProduct(rows[0]) : undefined;
  }

  async listProducts(): Promise<ProductRow[]> {
    const { rows } = await this.pool.query("SELECT * FROM products ORDER BY serial ASC");
    return rows.map(toProduct);
  }

  async setProductStatus(serial: number, status: ProductStatus, currentHolder?: string): Promise<void> {
    await this.pool.query(
      `UPDATE products
         SET status = $2,
             current_holder = COALESCE($3, current_holder),
             last_reconciled_at = $4
       WHERE serial = $1`,
      [serial, status, currentHolder ?? null, new Date().toISOString()],
    );
  }

  async upsertEvent(event: NewEventRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO events (topic_id, sequence_number, consensus_timestamp, serial, token_id, type, actor,
                           payload_json, payload_hash, ref, hash_valid, malformed_reason, raw_hash,
                           reconciliation, reconciliation_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,TRUE),$12,$13,COALESCE($14,'n/a'),$15)
       ON CONFLICT (topic_id, sequence_number) DO UPDATE SET
         consensus_timestamp = EXCLUDED.consensus_timestamp,
         serial = COALESCE(EXCLUDED.serial, events.serial),
         token_id = COALESCE(EXCLUDED.token_id, events.token_id),
         type = EXCLUDED.type,
         actor = COALESCE(EXCLUDED.actor, events.actor),
         payload_json = COALESCE(EXCLUDED.payload_json, events.payload_json),
         payload_hash = COALESCE(EXCLUDED.payload_hash, events.payload_hash),
         ref = COALESCE(EXCLUDED.ref, events.ref),
         hash_valid = EXCLUDED.hash_valid,
         malformed_reason = COALESCE(EXCLUDED.malformed_reason, events.malformed_reason),
         raw_hash = COALESCE(EXCLUDED.raw_hash, events.raw_hash),
         reconciliation = EXCLUDED.reconciliation,
         reconciliation_note = EXCLUDED.reconciliation_note`,
      [
        event.topicId,
        event.sequenceNumber,
        event.consensusTimestamp,
        event.serial ?? null,
        event.tokenId ?? null,
        event.type,
        event.actor ?? null,
        event.payloadJson ?? null,
        event.payloadHash ?? null,
        event.ref ?? null,
        event.hashValid ?? null,
        event.malformedReason ?? null,
        event.rawHash ?? null,
        event.reconciliation ?? null,
        event.reconciliationNote ?? null,
      ],
    );
  }

  async listEvents(serial: number): Promise<EventRow[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM events WHERE serial = $1 ORDER BY consensus_timestamp ASC, sequence_number ASC",
      [serial],
    );
    return rows.map(toEvent);
  }

  async listEventsByTopic(topicId: string): Promise<EventRow[]> {
    const { rows } = await this.pool.query("SELECT * FROM events WHERE topic_id = $1 ORDER BY sequence_number ASC", [
      topicId,
    ]);
    return rows.map(toEvent);
  }

  async listAllEvents(): Promise<EventRow[]> {
    const { rows } = await this.pool.query("SELECT * FROM events ORDER BY topic_id ASC, sequence_number ASC");
    return rows.map(toEvent);
  }

  async recordVerdicts(verdicts: readonly EventVerdict[]): Promise<void> {
    if (verdicts.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const verdict of verdicts) {
        await client.query(
          "UPDATE events SET reconciliation = $3, reconciliation_note = $4 WHERE topic_id = $1 AND sequence_number = $2",
          [verdict.topicId, verdict.sequenceNumber, verdict.reconciliation, verdict.note ?? null],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertTransfer(transfer: NewNftTransferRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO nft_transfers (token_id, serial, consensus_timestamp, sender, receiver, transaction_id, is_mint)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,FALSE))
       ON CONFLICT (token_id, serial, consensus_timestamp) DO UPDATE SET
         sender = COALESCE(EXCLUDED.sender, nft_transfers.sender),
         receiver = COALESCE(EXCLUDED.receiver, nft_transfers.receiver),
         transaction_id = COALESCE(EXCLUDED.transaction_id, nft_transfers.transaction_id),
         is_mint = EXCLUDED.is_mint`,
      [
        transfer.tokenId,
        transfer.serial,
        transfer.consensusTimestamp,
        transfer.sender ?? null,
        transfer.receiver ?? null,
        transfer.transactionId ?? null,
        transfer.isMint ?? null,
      ],
    );
  }

  async listTransfers(tokenId: string, serial: number): Promise<NftTransferRow[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM nft_transfers WHERE token_id = $1 AND serial = $2 ORDER BY consensus_timestamp ASC",
      [tokenId, serial],
    );
    return rows.map(toTransfer);
  }

  async getCursor(topicId: string): Promise<number> {
    const { rows } = await this.pool.query("SELECT last_sequence_number FROM cursors WHERE topic_id = $1", [topicId]);
    return rows[0] ? Number(rows[0].last_sequence_number) : 0;
  }

  async setCursor(topicId: string, lastSequenceNumber: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO cursors (topic_id, last_sequence_number, updated_at) VALUES ($1,$2,$3)
       ON CONFLICT (topic_id) DO UPDATE SET last_sequence_number = EXCLUDED.last_sequence_number,
                                           updated_at = EXCLUDED.updated_at`,
      [topicId, lastSequenceNumber, new Date().toISOString()],
    );
  }

  async listCursors(): Promise<Array<{ topicId: string; lastSequenceNumber: number }>> {
    const { rows } = await this.pool.query("SELECT * FROM cursors ORDER BY topic_id ASC");
    return rows.map(row => ({
      topicId: row.topic_id as string,
      lastSequenceNumber: Number(row.last_sequence_number),
    }));
  }

  async getPassport(serial: number): Promise<PassportView | undefined> {
    const product = await this.getProduct(serial);
    if (!product) return undefined;
    return {
      product,
      events: await this.listEvents(serial),
      transfers: await this.listTransfers(product.tokenId, serial),
    };
  }

  async stats(): Promise<IndexStats> {
    const { rows } = await this.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM events) AS events,
        (SELECT COUNT(*) FROM products WHERE status = 'verified') AS verified,
        (SELECT COUNT(*) FROM products WHERE status = 'pending') AS pending,
        (SELECT COUNT(*) FROM products WHERE status = 'discrepancy') AS discrepancies,
        (SELECT COUNT(DISTINCT topic_id) FROM products) AS topics
    `);
    const row = rows[0] ?? {};
    return {
      products: Number(row.products ?? 0),
      events: Number(row.events ?? 0),
      verified: Number(row.verified ?? 0),
      pending: Number(row.pending ?? 0),
      discrepancies: Number(row.discrepancies ?? 0),
      topics: Number(row.topics ?? 0),
    };
  }

  async reset(): Promise<void> {
    await this.pool.query("TRUNCATE events, products, cursors, nft_transfers RESTART IDENTITY");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Opens a migrated Postgres-backed index.
 *
 * @param connectionString Value of DATABASE_URL.
 * @returns A ready-to-use store.
 */
export async function openPostgresStore(connectionString: string): Promise<IndexStore> {
  const store = new PostgresIndexStore(connectionString);
  await store.migrate();
  return store;
}
