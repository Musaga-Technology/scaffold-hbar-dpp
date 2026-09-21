/**
 * Bootstrap cost model and funding preflight.
 *
 * Pure functions only — no network, no filesystem — so the arithmetic that
 * decides whether to abort is unit tested directly.
 */

/** Tinybars per HBAR. */
export const TINYBAR_PER_HBAR = 100_000_000n;

/** Default HBAR forwarded to the HTS system contract for token creation. */
export const DEFAULT_COLLECTION_FEE_HBAR = 20;

/** Estimated HBAR cost of deploying the registry contract. */
export const DEPLOY_COST_HBAR = 2;

/** Estimated HBAR cost of creating the topic and submitting the demo events. */
export const TOPIC_AND_EVENTS_COST_HBAR = 1;

/** Extra HBAR kept back so a fee estimate that runs slightly high does not strand the run. */
export const BUFFER_HBAR = 2;

/** One line of the funding estimate. */
export interface CostLine {
  label: string;
  hbar: number;
}

/** Outcome of the funding preflight. */
export interface FundingAssessment {
  /** True when the balance covers everything still to do. */
  sufficient: boolean;
  /** Total HBAR still required. */
  requiredHbar: number;
  /** HBAR missing; 0 when sufficient. */
  shortfallHbar: number;
  /** Per-item breakdown of what makes up requiredHbar. */
  breakdown: CostLine[];
}

/** What the bootstrap still has to pay for, given what already exists. */
export interface RemainingWork {
  /** True when the registry still has to be deployed. */
  needsDeploy: boolean;
  /** True when the collection still has to be created. */
  needsCollection: boolean;
  /** True when the demo topic and its events still have to be created. */
  needsTopic: boolean;
  /** HBAR forwarded as msg.value for token creation. */
  collectionFeeHbar: number;
}

/** Converts tinybars to HBAR as a number, for display and comparison only. */
export function tinybarToHbar(tinybar: bigint): number {
  return Number(tinybar) / Number(TINYBAR_PER_HBAR);
}

/** Converts whole or fractional HBAR to tinybars. */
export function hbarToTinybar(hbar: number): bigint {
  return BigInt(Math.round(hbar * Number(TINYBAR_PER_HBAR)));
}

/** Formats an HBAR amount for human-readable output. */
export function formatHbar(hbar: number): string {
  const rounded = Math.round(hbar * 1e8) / 1e8;
  return `${rounded} HBAR`;
}

/**
 * Reads the collection fee from the environment, falling back to the default.
 *
 * @param raw Value of BOOTSTRAP_COLLECTION_FEE_HBAR.
 * @returns HBAR to forward as msg.value for token creation.
 * @throws When the value is present but not a positive number.
 */
export function resolveCollectionFeeHbar(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_COLLECTION_FEE_HBAR;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`BOOTSTRAP_COLLECTION_FEE_HBAR must be a positive number — got "${raw}"`);
  }
  return value;
}

/**
 * Decides whether the deployer can afford the remaining bootstrap steps.
 *
 * Only unfinished work is charged for, so re-running a partially completed
 * bootstrap does not demand HBAR for steps that already succeeded.
 *
 * @param balanceHbar Deployer balance in HBAR.
 * @param work What still has to be done.
 * @returns The assessment, including a per-item breakdown for the error message.
 */
export function assessFunding(balanceHbar: number, work: RemainingWork): FundingAssessment {
  const breakdown: CostLine[] = [];

  if (work.needsDeploy) {
    breakdown.push({ label: "deploy PassportRegistry", hbar: DEPLOY_COST_HBAR });
  }
  if (work.needsCollection) {
    breakdown.push({ label: "HTS collection creation", hbar: work.collectionFeeHbar });
  }
  if (work.needsTopic) {
    breakdown.push({ label: "HCS topic + demo events", hbar: TOPIC_AND_EVENTS_COST_HBAR });
  }
  if (breakdown.length > 0) {
    breakdown.push({ label: "buffer", hbar: BUFFER_HBAR });
  }

  const requiredHbar = breakdown.reduce((total, line) => total + line.hbar, 0);
  const sufficient = balanceHbar >= requiredHbar;

  return {
    sufficient,
    requiredHbar,
    shortfallHbar: sufficient ? 0 : requiredHbar - balanceHbar,
    breakdown,
  };
}

/**
 * Builds the abort message shown when the deployer cannot afford the run.
 *
 * @param balanceHbar Deployer balance in HBAR.
 * @param assessment Result of assessFunding.
 * @param faucetUrl Faucet to point the developer at.
 * @returns A multi-line message naming the exact shortfall.
 */
export function describeShortfall(
  balanceHbar: number,
  assessment: FundingAssessment,
  faucetUrl = "https://portal.hedera.com/faucet",
): string {
  const lines = [
    `Insufficient balance: have ${formatHbar(balanceHbar)}, need ${formatHbar(assessment.requiredHbar)}.`,
    `Short by ${formatHbar(assessment.shortfallHbar)}.`,
    "",
    "What the remaining steps cost:",
    ...assessment.breakdown.map(line => `  ${line.label.padEnd(26)} ~${formatHbar(line.hbar)}`),
    "",
    `Fund the deployer at ${faucetUrl} and re-run. The bootstrap is idempotent —`,
    "steps that already succeeded are skipped.",
  ];
  return lines.join("\n");
}
