/**
 * Read access to the passport index.
 *
 * Two sources, chosen by configuration:
 *
 *   fixtures  bundled demo data — the default, so a fresh clone with no `.env`
 *             and no network still renders a complete, explorable passport.
 *   http      the index API served by `yarn indexer:dev`, or any deployment of
 *             it named by INDEX_API_URL.
 *
 * There is deliberately no third source that opens the index database directly.
 * The app is meant to deploy to serverless platforms with a read-only
 * filesystem and no native modules, so linking a SQLite driver here would make
 * the deployed app unable to read its own index. Reads go over HTTP or come
 * from fixtures — never from a file handle.
 *
 * Nothing in this module reads HCS. That is the architectural rule acceptance
 * assertion C8 checks in devtools.
 */
import demoForged from "../fixtures/demo-passport-forged.json";
import demoPassport from "../fixtures/demo-passport.json";
import demoStats from "../fixtures/demo-stats.json";

/** Per-event reconciliation outcome, as recorded by the indexer. */
export type ReconciliationState = "n/a" | "reconciled" | "discrepancy" | "pending";

/** Overall verification verdict for a passport. */
export type ProductStatus = "verified" | "pending" | "discrepancy";

export interface PassportProduct {
  serial: number;
  tokenId: string;
  topicId: string;
  productHash: string | null;
  issuer: string | null;
  category: string | null;
  name: string | null;
  metadataJson: string | null;
  currentHolder: string | null;
  status: ProductStatus;
  lastReconciledAt: string | null;
}

export interface PassportEventRow {
  id: number;
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string;
  serial: number | null;
  tokenId: string | null;
  type: string;
  actor: string | null;
  payload: Record<string, unknown> | null;
  payloadHash: string | null;
  ref: string | null;
  hashValid: boolean;
  malformedReason: string | null;
  rawHash: string | null;
  reconciliation: ReconciliationState;
  reconciliationNote: string | null;
}

/** What the indexer concluded about a referenced document. */
export type AttachmentState = "pending" | "verified" | "mismatch" | "unreachable";

export interface PassportAttachment {
  topicId: string;
  sequenceNumber: number;
  cid: string;
  declaredHash: string;
  name: string | null;
  mediaType: string | null;
  observedHash: string | null;
  bytes: number | null;
  state: AttachmentState;
  note: string | null;
  checkedAt: string | null;
}

export interface PassportTransfer {
  tokenId: string;
  serial: number;
  consensusTimestamp: string;
  sender: string | null;
  receiver: string | null;
  transactionId: string | null;
  isMint: boolean;
}

export interface PassportView {
  product: PassportProduct;
  events: PassportEventRow[];
  transfers: PassportTransfer[];
  attachments: PassportAttachment[];
}

export interface IndexStats {
  products: number;
  events: number;
  attachments: number;
  attachmentsVerified: number;
  attachmentsFailed: number;
  verified: number;
  pending: number;
  discrepancies: number;
  topics: number;
}

/** Which source is answering reads. */
export type DataSource = "fixtures" | "http";

/**
 * Decides where reads come from.
 *
 * Fixtures win unless an index API is configured, and PASSPORT_DATA_SOURCE can
 * force fixtures even when one is — useful for a demo deployment that should
 * never depend on a running indexer.
 */
export function dataSource(): DataSource {
  if (process.env.PASSPORT_DATA_SOURCE === "fixtures") return "fixtures";
  return process.env.INDEX_API_URL ? "http" : "fixtures";
}

/** True when the app is serving bundled demo data, so the UI can say so. */
export function isDemoMode(): boolean {
  return dataSource() === "fixtures";
}

const FIXTURES: PassportView[] = [demoPassport as unknown as PassportView, demoForged as unknown as PassportView];

function indexApiUrl(path: string): string {
  const base = (process.env.INDEX_API_URL ?? "").replace(/\/+$/, "");
  return `${base}${path}`;
}

/**
 * Fetches from the index API.
 *
 * `no-store` because the index changes as the indexer catches up; a cached
 * "pending" would be shown long after it had become "verified".
 *
 * @returns Parsed body, or undefined on 404.
 * @throws When the index API is unreachable or errors.
 */
async function fetchFromIndex<T>(path: string): Promise<T | undefined> {
  const response = await fetch(indexApiUrl(path), { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Index API ${path} failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * Loads one passport.
 *
 * @param serial Serial to load.
 * @returns The passport, or undefined when it is not in the index.
 */
export async function getPassport(serial: number): Promise<PassportView | undefined> {
  if (dataSource() === "fixtures") {
    return FIXTURES.find(view => view.product.serial === serial);
  }
  return fetchFromIndex<PassportView>(`/api/passport/products/${serial}`);
}

/**
 * Lists every passport in the index.
 *
 * @returns Products, ascending by serial.
 */
export async function listProducts(): Promise<PassportProduct[]> {
  if (dataSource() === "fixtures") {
    return FIXTURES.map(view => view.product);
  }
  const body = await fetchFromIndex<{ products: PassportProduct[] }>("/api/passport/products");
  return body?.products ?? [];
}

/**
 * Lists one passport's events.
 *
 * @param serial Serial to load events for.
 * @returns Events in consensus order; empty when the serial is unknown.
 */
export async function listEvents(serial: number): Promise<PassportEventRow[]> {
  if (dataSource() === "fixtures") {
    return FIXTURES.find(view => view.product.serial === serial)?.events ?? [];
  }
  const body = await fetchFromIndex<{ events: PassportEventRow[] }>(`/api/passport/products/${serial}/events`);
  return body?.events ?? [];
}

/** Registry-wide counts for the landing page. */
export async function getStats(): Promise<IndexStats> {
  if (dataSource() === "fixtures") {
    return demoStats as unknown as IndexStats;
  }
  return (
    (await fetchFromIndex<IndexStats>("/api/passport/stats")) ?? {
      products: 0,
      events: 0,
      attachments: 0,
      attachmentsVerified: 0,
      attachmentsFailed: 0,
      verified: 0,
      pending: 0,
      discrepancies: 0,
      topics: 0,
    }
  );
}
