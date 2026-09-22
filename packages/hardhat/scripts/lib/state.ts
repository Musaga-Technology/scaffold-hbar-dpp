/**
 * Bootstrap state file.
 *
 * `passport.state.json` records everything the bootstrap created so a re-run
 * skips finished work, and so `yarn passport:status` can check each entity
 * against the mirror node. It holds ids and transaction ids only — never keys.
 */
import fs from "node:fs";
import path from "node:path";

/** Entities created by a bootstrap run, per network. */
export interface PassportState {
  /** Schema version of this file. */
  version: 1;
  /** Hedera network these ids belong to (`hederaTestnet`, `hederaMainnet`, …). */
  network: string;
  /** Deployer EVM address, so `passport:status` can report its balance without the key. */
  deployerAddress?: string;
  /** Deployed registry contract address. */
  registryAddress?: string;
  /** HTS collection address in EVM form. */
  collectionAddress?: string;
  /** HTS collection id in Hedera form (`0.0.x`). */
  tokenId?: string;
  /** Demo product's serial number. */
  serial?: number;
  /** Demo product's HCS topic id (`0.0.x`). */
  topicId?: string;
  /** EVM transaction hash of the registerProduct call. */
  registerTxHash?: string;
  /** What the serial's HIP-412 metadata points at — `ipfs://…` or an app URL. */
  metadataPointer?: string;
  /** Hedera transaction ids of the demo events submitted to the topic. */
  eventTransactionIds?: string[];
  /** CID of the demo document attached to the inspection event, when one was pinned. */
  documentCid?: string;
  /**
   * Products registered by earlier runs, kept when `BOOTSTRAP_NEW_PRODUCT=true`
   * starts another. Their topics stay in the indexer's list, so registering a
   * second product never makes the first one disappear.
   */
  previousProducts?: Array<{ serial: number; topicId: string; metadataPointer?: string; documentCid?: string }>;
  /** ISO timestamp of the last successful bootstrap step. */
  updatedAt?: string;
}

/** Default location of the state file, relative to the hardhat workspace root. */
export const STATE_FILENAME = "passport.state.json";

/** Builds an empty state for a network. */
export function emptyState(network: string): PassportState {
  return { version: 1, network };
}

/**
 * Reads the state file.
 *
 * A state file belonging to a different network is ignored rather than merged,
 * so switching networks cannot make the bootstrap skip work it has not done
 * there. A corrupt file is also ignored, with a warning, so a bad edit does not
 * wedge the developer.
 *
 * @param filePath Path to the state file.
 * @param network Network the caller is bootstrapping.
 * @param warn Sink for warnings.
 * @returns Stored state for that network, or a fresh empty state.
 */
export function readState(
  filePath: string,
  network: string,
  warn: (message: string) => void = console.warn,
): PassportState {
  if (!fs.existsSync(filePath)) return emptyState(network);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    warn(`Ignoring unreadable ${path.basename(filePath)} — starting from a clean state.`);
    return emptyState(network);
  }

  if (typeof parsed !== "object" || parsed === null) {
    warn(`Ignoring malformed ${path.basename(filePath)} — starting from a clean state.`);
    return emptyState(network);
  }

  const state = parsed as PassportState;
  if (state.network !== network) {
    warn(`${path.basename(filePath)} holds ${state.network} ids; starting a clean state for ${network}.`);
    return emptyState(network);
  }

  return { ...emptyState(network), ...state };
}

/**
 * Writes the state file, stamping updatedAt.
 *
 * @param filePath Path to the state file.
 * @param state State to persist.
 */
export function writeState(filePath: string, state: PassportState): void {
  const withTimestamp: PassportState = { ...state, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(withTimestamp, null, 2)}\n`, "utf8");
}

/** Reports which bootstrap steps still have to run for this state. */
export function remainingSteps(state: PassportState): {
  needsDeploy: boolean;
  needsCollection: boolean;
  needsTopic: boolean;
  needsProduct: boolean;
} {
  return {
    needsDeploy: !state.registryAddress,
    needsCollection: !state.collectionAddress,
    needsTopic: !state.topicId,
    needsProduct: state.serial === undefined,
  };
}
