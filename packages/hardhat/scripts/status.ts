/**
 * Diagnostics for a bootstrapped deployment.
 *
 * Reads `passport.state.json` and checks every recorded entity against the
 * mirror node — the same source the indexer reads, so what this reports is what
 * the indexer can see. Needs no key and makes no transaction.
 *
 * This is the first thing to run when something looks wrong.
 */
import * as dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

import {
  fetchAccountByEvmAddress,
  hashscan,
  mirrorGet,
  mirrorNodeUrl,
  resolveNetwork,
  type HederaNetwork,
} from "./lib/hedera";
import { formatHbar, tinybarToHbar } from "./lib/preflight";
import { STATE_FILENAME, readState, type PassportState } from "./lib/state";

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "..", "..");

const OK = "  ok    ";
const MISSING = "  gone  ";
const UNSET = "  unset ";

function line(status: string, label: string, detail: string): void {
  console.log(`${status}${label.padEnd(12)}${detail}`);
}

/** Reports the indexer's cursor, if it has run and left a SQLite index behind. */
function reportIndexer(): void {
  const dbPath = path.join(REPO_ROOT, "packages", "indexer", "data", "passport.db");
  if (!fs.existsSync(dbPath)) {
    line(UNSET, "indexer", "no local index yet — run `yarn indexer:dev`");
    return;
  }
  const { size, mtime } = fs.statSync(dbPath);
  line(OK, "indexer", `${path.relative(REPO_ROOT, dbPath)} (${size} bytes, updated ${mtime.toISOString()})`);
}

/** Checks the entities the bootstrap recorded. */
async function reportEntities(state: PassportState, network: HederaNetwork, mirror: string): Promise<void> {
  if (state.registryAddress) {
    const code = await hre.ethers.provider.getCode(state.registryAddress);
    const deployed = code !== undefined && code !== "0x";
    line(
      deployed ? OK : MISSING,
      "contract",
      `${state.registryAddress}  ${hashscan.contract(network, state.registryAddress)}`,
    );
  } else {
    line(UNSET, "contract", "not deployed — run `yarn passport:bootstrap`");
  }

  if (state.tokenId) {
    const token = await mirrorGet<{ token_id: string; total_supply: string }>(
      mirror,
      `/api/v1/tokens/${state.tokenId}`,
    );
    line(
      token ? OK : MISSING,
      "token",
      `${state.tokenId}${token ? ` (supply ${token.total_supply})` : " — not on the mirror node"}  ${hashscan.token(network, state.tokenId)}`,
    );
  } else {
    line(UNSET, "token", "no collection created");
  }

  if (state.tokenId && state.serial !== undefined) {
    const nft = await mirrorGet<{ account_id: string; deleted: boolean }>(
      mirror,
      `/api/v1/tokens/${state.tokenId}/nfts/${state.serial}`,
    );
    line(
      nft ? OK : MISSING,
      "serial",
      `${state.serial}${nft ? ` held by ${nft.account_id}` : " — not on the mirror node"}  ${hashscan.serial(network, state.tokenId, state.serial)}`,
    );
  } else {
    line(UNSET, "serial", "no product registered");
  }

  if (state.topicId) {
    const messages = await mirrorGet<{ messages: unknown[] }>(
      mirror,
      `/api/v1/topics/${state.topicId}/messages?limit=100&order=asc`,
    );
    const count = messages?.messages.length ?? 0;
    line(
      messages ? OK : MISSING,
      "topic",
      `${state.topicId} (${count} message${count === 1 ? "" : "s"})  ${hashscan.topic(network, state.topicId)}`,
    );
  } else {
    line(UNSET, "topic", "no topic created");
  }
}

async function main(): Promise<void> {
  const network = resolveNetwork(hre.network.name, hre.network.config.chainId);
  const mirror = mirrorNodeUrl(network);
  const statePath = path.join(WORKSPACE_ROOT, STATE_FILENAME);

  console.log(`\nproduct-passport status — ${network}\n`);

  if (!fs.existsSync(statePath)) {
    console.log(`No ${STATE_FILENAME} found.`);
    console.log("Nothing has been bootstrapped on this machine yet. Run:\n");
    console.log("  yarn passport:bootstrap\n");
    return;
  }

  const state = readState(statePath, hre.network.name);
  await reportEntities(state, network, mirror);
  reportIndexer();

  if (state.metadataPointer) {
    const pinned = state.metadataPointer.startsWith("ipfs://");
    line(
      pinned ? OK : UNSET,
      "metadata",
      pinned
        ? `${state.metadataPointer}  (content-addressed)`
        : `${state.metadataPointer}  (served by the app — set PINATA_JWT to pin it instead)`,
    );
  }

  if (state.deployerAddress) {
    const account = await fetchAccountByEvmAddress(mirror, state.deployerAddress);
    const balance = account?.balance ? tinybarToHbar(BigInt(account.balance.balance)) : undefined;
    line(
      account ? OK : MISSING,
      "deployer",
      account
        ? `${account.account} — ${formatHbar(balance ?? 0)}  ${hashscan.account(network, account.account)}`
        : `${state.deployerAddress} — no account on the mirror node (unfunded?)`,
    );
  }

  console.log(`\nstate file: ${path.relative(REPO_ROOT, statePath)}`);
  if (state.updatedAt) console.log(`last bootstrap step: ${state.updatedAt}`);
  console.log();
}

main().catch(error => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
