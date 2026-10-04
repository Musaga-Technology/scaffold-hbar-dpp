/**
 * Publishes the registry's source on HashScan.
 *
 * Reads the registry address from `passport.state.json`, compiles, and submits
 * the exact compiler input to Sourcify, which HashScan reads. Makes no
 * transaction and needs no key. Safe to re-run: an already verified registry is
 * reported and left alone.
 */
import * as dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

import { hashscan, resolveNetwork } from "./lib/hedera";
import { buildVerifyBody, existingMatch, verifyOnSourcify } from "./lib/sourcify";
import { STATE_FILENAME, readState } from "./lib/state";

const CONTRACT = "contracts/PassportRegistry.sol:PassportRegistry";
const WORKSPACE_ROOT = path.resolve(__dirname, "..");

async function main(): Promise<void> {
  const network = resolveNetwork(hre.network.name, hre.network.config.chainId);
  const chainId = hre.network.config.chainId;
  const statePath = path.join(WORKSPACE_ROOT, STATE_FILENAME);

  if (!chainId || !fs.existsSync(statePath)) {
    console.log("Nothing to verify yet — run `yarn passport:bootstrap` first.");
    return;
  }
  const { registryAddress } = readState(statePath, hre.network.name);
  if (!registryAddress) {
    console.log("No registry recorded in passport.state.json — run `yarn passport:bootstrap` first.");
    return;
  }

  const link = hashscan.contract(network, registryAddress);
  const already = await existingMatch(chainId, registryAddress);
  if (already) {
    console.log(`Already verified (${already}): ${link}`);
    return;
  }

  await hre.run("compile", { quiet: true });
  const buildInfo = await hre.artifacts.getBuildInfo(CONTRACT);
  if (!buildInfo) throw new Error(`No build info for ${CONTRACT}.`);

  console.log(`Verifying ${registryAddress} on Sourcify…`);
  const outcome = await verifyOnSourcify(chainId, registryAddress, buildVerifyBody(buildInfo, CONTRACT));

  if (outcome.state === "verified") {
    console.log(`Verified (${outcome.match}). Source is on HashScan: ${link}`);
  } else if (outcome.state === "pending") {
    console.log(`Sourcify is still working on it. Check again shortly: ${link}`);
  } else {
    // Most often the contract was compiled from different source than what is
    // checked out now — Sourcify needs the exact bytecode.
    console.error(`Verification failed: ${outcome.message}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
