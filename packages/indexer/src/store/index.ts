/**
 * Index storage.
 *
 * SQLite is the zero-setup default; Postgres is selected by DATABASE_URL. The
 * factory never silently falls back between them — an operator who set
 * DATABASE_URL and got a local SQLite file would not think to look for it.
 */
import type { IndexerConfig } from "../config.js";
import { openPostgresStore } from "./postgres.js";
import { openSqliteStore } from "./sqlite.js";
import type { IndexStore } from "./types.js";

export { SqliteIndexStore, openSqliteStore } from "./sqlite.js";
export { PostgresIndexStore, openPostgresStore } from "./postgres.js";
export * from "./schema.js";
export type { EventVerdict, IndexStats, IndexStore, PassportView } from "./types.js";

/**
 * Opens the index described by the config.
 *
 * @param config Resolved indexer configuration.
 * @returns A migrated store ready for reads and writes.
 */
export async function createStore(config: IndexerConfig): Promise<IndexStore> {
  return config.databaseUrl ? openPostgresStore(config.databaseUrl) : openSqliteStore(config.dbPath);
}

/** Opens a throwaway in-memory index, for tests and for `indexer:verify`. */
export async function createMemoryStore(): Promise<IndexStore> {
  return openSqliteStore(":memory:");
}
