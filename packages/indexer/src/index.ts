/**
 * product-passport indexer CLI.
 *
 * Reads the Hedera mirror node, replays each product's HCS event log into a
 * local database, and reconciles custody claims against real NFT transfers.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { startApi } from "./api.js";
import { hasIndexTarget, loadConfig, type IndexerConfig } from "./config.js";
import { resolveTopicIds } from "./discover.js";
import { MirrorNodeClient } from "./mirror.js";
import { pollOnce } from "./poller.js";
import { reconcileAll } from "./reconcile.js";
import { createStore } from "./store/index.js";
import { formatVerifyReport, verifyAgainstReplay } from "./verify.js";

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

/** What the argument parser decided, before any work is done. */
export type ParsedArgs =
  | { kind: "help"; exitCode: number }
  | { kind: "error"; message: string; exitCode: 1 }
  | { kind: "run"; command: Command };

/**
 * Parses argv without touching the environment, a database or a network.
 *
 * @param argv Arguments after the node binary and script path.
 * @returns What to do next.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command] = argv;

  if (command === undefined) return { kind: "help", exitCode: 1 };
  if (command === "help" || command === "--help" || command === "-h") return { kind: "help", exitCode: 0 };
  if (!isCommand(command)) return { kind: "error", message: `Unknown command "${command}".`, exitCode: 1 };

  return { kind: "run", command };
}

/** Prints a poll pass in one line per topic. */
function reportPoll(results: Awaited<ReturnType<typeof pollOnce>>, out: (line: string) => void): void {
  for (const result of results) {
    if (result.written === 0 && result.incomplete === 0) continue;
    const parts = [`${result.topicId}: +${result.written} event(s) to sequence ${result.cursor}`];
    if (result.malformed > 0) parts.push(`${result.malformed} malformed`);
    if (result.incomplete > 0) parts.push(`${result.incomplete} incomplete chunk set(s)`);
    out(`  ${parts.join(", ")}`);
  }
}

/**
 * Runs one command against a live store and mirror node.
 *
 * @param command Command to run.
 * @param config Resolved configuration.
 * @param out Sink for human-readable output.
 * @returns Process exit code.
 */
export async function runCommand(
  command: Command,
  config: IndexerConfig,
  out: (line: string) => void = console.log,
): Promise<number> {
  const mirror = new MirrorNodeClient(config.mirrorNodeUrl);
  const store = await createStore(config);

  try {
    const topicIds = await resolveTopicIds(mirror, config.topicIds, config.registryAddress);
    if (topicIds.length === 0) {
      out("\nNo topics to index.");
      out("Set INDEXER_TOPIC_IDS, or point PASSPORT_REGISTRY_ADDRESS at a registry that has registered a product.");
      return 1;
    }
    out(`\nTopics: ${topicIds.join(", ")}`);

    if (command === "verify") {
      const report = await verifyAgainstReplay(store, mirror, topicIds);
      out("");
      out(formatVerifyReport(report));
      return report.ok ? 0 : 1;
    }

    if (command === "replay") {
      out("\nDropping the index and rebuilding from sequence 1…");
      await store.reset();
      reportPoll(await pollOnce(store, mirror, topicIds), out);
      const summaries = await reconcileAll(store, mirror);
      for (const summary of summaries) {
        out(`  serial ${summary.serial}: ${summary.status}${summary.discrepancies ? " ⚠" : ""}`);
      }
      out("\nRebuilt. Run `yarn indexer:verify` to prove it matches the ledger.");
      return 0;
    }

    // dev: poll, reconcile, serve, repeat until interrupted.
    const server = startApi(store, config.port);
    out(`\nIndex API on http://localhost:${config.port} (GET /products, /products/:serial, /stats)`);
    out(`Polling every ${config.pollMs}ms. Ctrl-C to stop.\n`);

    let stopped = false;
    const stop = () => {
      stopped = true;
      server.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    while (!stopped) {
      try {
        reportPoll(await pollOnce(store, mirror, topicIds), out);
        await reconcileAll(store, mirror);
      } catch (error) {
        // A mirror node blip must not kill a long-running indexer.
        out(`  poll failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise(resolve => setTimeout(resolve, config.pollMs));
    }

    return 0;
  } finally {
    await store.close();
  }
}

/**
 * CLI entry point.
 *
 * @param argv Arguments after the node binary and script path.
 * @param out Sink for human-readable output; injected so tests can capture it.
 * @returns Process exit code.
 */
export async function main(argv: readonly string[], out: (line: string) => void = console.log): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.kind === "help") {
    out(USAGE);
    return parsed.exitCode;
  }
  if (parsed.kind === "error") {
    out(`${parsed.message}\n`);
    out(USAGE);
    return parsed.exitCode;
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

  try {
    return await runCommand(parsed.command, config, out);
  } catch (error) {
    out(`\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Run only when this file is the process entry point, so tests can import main().
const entryPoint = process.argv[1];
if (entryPoint !== undefined && realpathSync(entryPoint) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
