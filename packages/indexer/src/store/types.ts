/**
 * The storage contract the rest of the indexer is written against.
 *
 * The poller, the reconciler and the read API all talk to this interface and
 * never to a driver. That keeps three things easy: swapping SQLite for Postgres,
 * standing up an in-memory store in tests, and `indexer:verify`, which is just
 * "open a second store, replay into it, diff the two".
 */
import type {
  EventRow,
  NewEventRow,
  NewNftTransferRow,
  NewProductRow,
  NftTransferRow,
  ProductRow,
  ProductStatus,
  ReconciliationState,
} from "./schema.js";

/** A reconciliation verdict to record against one event. */
export interface EventVerdict {
  topicId: string;
  sequenceNumber: number;
  reconciliation: ReconciliationState;
  note?: string;
}

/** Everything the read API serves for one passport. */
export interface PassportView {
  product: ProductRow;
  events: EventRow[];
  transfers: NftTransferRow[];
}

/** Aggregate counts for the landing page. */
export interface IndexStats {
  products: number;
  events: number;
  verified: number;
  pending: number;
  discrepancies: number;
  topics: number;
}

/**
 * Every method is async even though the default SQLite driver is synchronous.
 *
 * Postgres drivers are not, and an interface that assumed sync would have to be
 * rewritten - along with every caller - the moment DATABASE_URL was supported.
 * The cost of a Promise the SQLite store resolves immediately is trivial; the
 * cost of that rewrite is not.
 */
export interface IndexStore {
  /** Creates tables if they do not exist. Safe to call repeatedly. */
  migrate(): Promise<void>;

  /** Inserts or updates a product by serial. */
  upsertProduct(product: NewProductRow): Promise<void>;
  getProduct(serial: number): Promise<ProductRow | undefined>;
  listProducts(): Promise<ProductRow[]>;
  setProductStatus(serial: number, status: ProductStatus, currentHolder?: string): Promise<void>;

  /**
   * Inserts or updates one decoded message, keyed by (topicId, sequenceNumber).
   *
   * Must be idempotent: the poller re-reads ranges after a restart, and a replay
   * writes the same rows again from scratch.
   */
  upsertEvent(event: NewEventRow): Promise<void>;
  listEvents(serial: number): Promise<EventRow[]>;
  listEventsByTopic(topicId: string): Promise<EventRow[]>;
  listAllEvents(): Promise<EventRow[]>;
  recordVerdicts(verdicts: readonly EventVerdict[]): Promise<void>;

  /** Inserts or updates an observed NFT transfer. */
  upsertTransfer(transfer: NewNftTransferRow): Promise<void>;
  listTransfers(tokenId: string, serial: number): Promise<NftTransferRow[]>;

  getCursor(topicId: string): Promise<number>;
  setCursor(topicId: string, lastSequenceNumber: number): Promise<void>;
  listCursors(): Promise<Array<{ topicId: string; lastSequenceNumber: number }>>;

  getPassport(serial: number): Promise<PassportView | undefined>;
  stats(): Promise<IndexStats>;

  /** Removes every row, for `indexer:replay`. */
  reset(): Promise<void>;

  close(): Promise<void>;
}
