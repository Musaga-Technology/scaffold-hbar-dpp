import { DEFAULT_ARWEAVE_GATEWAY, DEFAULT_IPFS_GATEWAY } from "./events/index.js";

/**
 * Indexer configuration, resolved from the environment.
 *
 * Every value has a working default so `yarn indexer:dev` runs with no .env at
 * all. Only the topic/registry settings decide what actually gets indexed, and
 * the CLI reports clearly when neither is set rather than silently idling.
 */

/** Mirror node REST base URLs, by Hedera network. */
export const MIRROR_NODE_URLS = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
} as const;

export type HederaNetwork = keyof typeof MIRROR_NODE_URLS;

export interface IndexerConfig {
  /** Hedera network the mirror node is read from. */
  network: HederaNetwork;
  /** Mirror node REST base URL, without a trailing slash. */
  mirrorNodeUrl: string;
  /** Explicit topic ids to index. Takes precedence over registry discovery. */
  topicIds: string[];
  /** Registry contract address; topics are discovered from its ProductRegistered logs. */
  registryAddress?: string;
  /** Milliseconds between mirror node polls. */
  pollMs: number;
  /** SQLite file backing the index. Ignored when databaseUrl is set. */
  dbPath: string;
  /** Postgres connection string. When set, Postgres is used instead of SQLite. */
  databaseUrl?: string;
  /** Port for the read-only index API served by `dev`. */
  port: number;
  /** Gateways used to read attachments back for verification, per network. */
  gateways: { ipfs: string; arweave: string };
}

const DEFAULTS = {
  network: "testnet" as HederaNetwork,
  pollMs: 5000,
  dbPath: "./data/passport.db",
  port: 3001,
};

function parseNetwork(raw: string | undefined): HederaNetwork {
  if (!raw) return DEFAULTS.network;
  const value = raw.toLowerCase();
  if (value in MIRROR_NODE_URLS) return value as HederaNetwork;
  throw new Error(`HEDERA_NETWORK must be one of ${Object.keys(MIRROR_NODE_URLS).join(", ")} — got "${raw}"`);
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer — got "${raw}"`);
  }
  return value;
}

/** Splits a comma-separated list, dropping blanks and surrounding whitespace. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/** Builds the indexer config from an environment map. Throws on malformed values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const network = parseNetwork(env.HEDERA_NETWORK);

  return {
    network,
    mirrorNodeUrl: (env.MIRROR_NODE_URL ?? MIRROR_NODE_URLS[network]).replace(/\/+$/, ""),
    topicIds: parseList(env.INDEXER_TOPIC_IDS),
    registryAddress: env.PASSPORT_REGISTRY_ADDRESS || undefined,
    pollMs: parsePositiveInt(env.INDEXER_POLL_MS, DEFAULTS.pollMs, "INDEXER_POLL_MS"),
    dbPath: env.INDEX_DB_PATH || DEFAULTS.dbPath,
    databaseUrl: env.DATABASE_URL || undefined,
    port: parsePositiveInt(env.INDEXER_PORT, DEFAULTS.port, "INDEXER_PORT"),
    gateways: {
      ipfs: (env.IPFS_GATEWAY_URL ?? DEFAULT_IPFS_GATEWAY).replace(/\/+$/, ""),
      arweave: (env.ARWEAVE_GATEWAY_URL ?? DEFAULT_ARWEAVE_GATEWAY).replace(/\/+$/, ""),
    },
  };
}

/** True when the config names something to index. */
export function hasIndexTarget(config: IndexerConfig): boolean {
  return config.topicIds.length > 0 || config.registryAddress !== undefined;
}
