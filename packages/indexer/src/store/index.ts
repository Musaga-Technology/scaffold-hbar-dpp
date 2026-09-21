/**
 * Index storage.
 *
 * SQLite is the zero-setup default. Postgres is selected by DATABASE_URL and
 * lands with the Docker Compose deployment in increment 04 — until then the
 * factory says so plainly rather than silently writing to a local SQLite file
 * the operator did not ask for and will not think to look in.
 */
import type { IndexerConfig } from "../config.js";
import { openSqliteStore } from "./sqlite.js";
import type { IndexStore } from "./types.js";

export { SqliteIndexStore, openSqliteStore } from "./sqlite.js";
export * from "./schema.js";
export type { EventVerdict, IndexStats, IndexStore, PassportView } from "./types.js";

/**
 * Opens the index described by the config.
 *
 * @param config Resolved indexer configuration.
 * @returns A migrated store ready for reads and writes.
 */
export async function createStore(config: IndexerConfig): Promise<IndexStore> {
  if (config.databaseUrl) {
    throw new Error(
      "DATABASE_URL is set, but the Postgres adapter is not implemented yet (it lands with the Docker Compose\n" +
        "deployment in increment 04). Unset DATABASE_URL to use the SQLite index at " +
        `${config.dbPath}, which needs no setup.`,
    );
  }
  return openSqliteStore(config.dbPath);
}

/** Opens a throwaway in-memory index, for tests and for `indexer:verify`. */
export async function createMemoryStore(): Promise<IndexStore> {
  return openSqliteStore(":memory:");
}
