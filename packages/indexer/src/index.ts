/**
 * product-passport indexer CLI.
 *
 * Reads the Hedera mirror node, replays each product's HCS event log into a
 * local database, and reconciles custody claims against real NFT transfers.
 *
 * The poller, store and reconciliation land in increment 02; this entry point
 * owns argument parsing, config resolution and diagnostics.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasIndexTarget, loadConfig, type IndexerConfig } from "./config.js";

const COMMANDS = ["dev", "replay", "verify"] as const;
export type Command = (typeof COMMANDS)[number];

const USAGE = `product-passport indexer

Usage:
  yarn indexer:dev        Poll the mirror node and serve the read-only index API
  yarn indexer:replay     Drop the index and rebuild it from sequence 1
  yarn indexer:verify     Replay into a temp index, diff against the live one

Environment:
  HEDERA_NETWORK             testnet (default) | mainnet | previewnet
  MIRROR_NODE_URL            Override the mirror node REST base URL
  INDEXER_TOPIC_IDS          Comma-separated topic ids to index (0.0.x,0.0.y)
  PASSPORT_REGISTRY_ADDRESS  Discover topics from ProductRegistered logs
  INDEXER_POLL_MS            Poll interval in ms (default 5000)
  INDEX_DB_PATH              SQLite file (default ./data/passport.db)
  DATABASE_URL               Use Postgres instead of SQLite
  INDEXER_PORT               Index API port for \`dev\` (default 3001)

Run \`yarn passport:bootstrap\` first — it writes packages/indexer/.env.local
with the registry address and the demo product's topic id.`;

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/** Renders the resolved config so operators can see what the indexer will do. */
export function describeConfig(config: IndexerConfig): string {
  const target = config.topicIds.length
    ? `topics ${config.topicIds.join(", ")}`
    : config.registryAddress
      ? `registry ${config.registryAddress}`
      : "nothing configured";
  const store = config.databaseUrl ? "postgres (DATABASE_URL)" : `sqlite ${config.dbPath}`;

  return [
    `network:     ${config.network}`,
    `mirror node: ${config.mirrorNodeUrl}`,
    `indexing:    ${target}`,
    `store:       ${store}`,
    `poll:        ${config.pollMs}ms`,
  ].join("\n");
}

/**
 * CLI entry point.
 *
 * @param argv Arguments after the node binary and script path.
 * @param out Sink for human-readable output; injected so tests can capture it.
 * @returns Process exit code.
 */
export function main(argv: readonly string[], out: (line: string) => void = console.log): number {
  const [command] = argv;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    out(USAGE);
    return command === undefined ? 1 : 0;
  }

  if (!isCommand(command)) {
    out(`Unknown command "${command}".\n`);
    out(USAGE);
    return 1;
  }

  let config: IndexerConfig;
  try {
    config = loadConfig();
  } catch (error) {
    out(`Configuration error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  out(describeConfig(config));

  if (!hasIndexTarget(config)) {
    out("\nNothing to index: set INDEXER_TOPIC_IDS or PASSPORT_REGISTRY_ADDRESS.");
    out("Run `yarn passport:bootstrap` to create a demo product and write these for you.");
    return 1;
  }

  out(`\n"${command}" is implemented in increment 02.`);
  return 0;
}

// Run only when this file is the process entry point, so tests can import main().
const entryPoint = process.argv[1];
if (entryPoint !== undefined && realpathSync(entryPoint) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
