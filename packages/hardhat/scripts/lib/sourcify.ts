/**
 * Source verification through Sourcify, which HashScan reads.
 *
 * `hardhat verify` cannot do this any more: hardhat-verify 2.x, the last line
 * that runs on Hardhat 2, calls Sourcify's v1 API, which Sourcify has removed.
 * This uses v2 — submit the compiler's standard JSON input, then poll the job.
 * Sourcify reads the constructor arguments from the creation transaction, so
 * none are needed here.
 */

/** Sourcify's API root. Hedera testnet (296) and mainnet (295) are supported there. */
export const SOURCIFY_API = "https://sourcify.dev/server";

const USER_AGENT = "product-passport (github.com/Musaga-Technology/scaffold-hbar-dpp)";

/** The parts of a Hardhat build-info file a verification needs. */
export interface BuildInfoLike {
  solcLongVersion: string;
  input: { sources: Record<string, unknown> };
}

/** Body of `POST /v2/verify/{chainId}/{address}`. */
export interface VerifyRequestBody {
  stdJsonInput: BuildInfoLike["input"];
  compilerVersion: string;
  contractIdentifier: string;
}

/** What a finished verification came to. */
export type VerificationOutcome =
  | { state: "verified"; match: string }
  | { state: "failed"; message: string }
  | { state: "pending" };

type Fetch = typeof fetch;

/**
 * Builds the request body for one contract.
 *
 * @param buildInfo Hardhat build info containing the contract.
 * @param contractIdentifier `path/To.sol:Name`, as Hardhat names it.
 * @returns The body to POST.
 * @throws When the build info does not contain the contract's source.
 */
export function buildVerifyBody(buildInfo: BuildInfoLike, contractIdentifier: string): VerifyRequestBody {
  const sourceName = contractIdentifier.split(":")[0];
  if (!(sourceName in buildInfo.input.sources)) {
    throw new Error(`${sourceName} is not in this build — run \`yarn hardhat:compile\` first.`);
  }
  return {
    stdJsonInput: buildInfo.input,
    compilerVersion: buildInfo.solcLongVersion,
    contractIdentifier,
  };
}

/**
 * Reads a verification job's state.
 *
 * @param job Body of `GET /v2/verify/{verificationId}`.
 * @returns Verified with its match kind, failed with Sourcify's reason, or pending.
 */
export function interpretJob(job: {
  isJobCompleted?: boolean;
  contract?: { match?: string | null } | null;
  error?: { message?: string } | null;
}): VerificationOutcome {
  if (!job.isJobCompleted) return { state: "pending" };
  if (job.error) return { state: "failed", message: job.error.message ?? "Sourcify rejected the verification." };
  const match = job.contract?.match;
  return match ? { state: "verified", match } : { state: "failed", message: "Sourcify finished without a match." };
}

/**
 * Looks up whether an address is already verified.
 *
 * @returns The match kind (`match` or `exact_match`), or null when it is not verified.
 */
export async function existingMatch(
  chainId: number,
  address: string,
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  const response = await fetchImpl(`${SOURCIFY_API}/v2/contract/${chainId}/${address}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Sourcify lookup failed: ${response.status} ${response.statusText}`);
  const body = (await response.json()) as { match?: string | null };
  return body.match ?? null;
}

/**
 * Submits a verification and waits for Sourcify to finish it.
 *
 * @param chainId 296 for Hedera testnet, 295 for mainnet.
 * @param address Deployed contract address.
 * @param body From {@link buildVerifyBody}.
 * @param options Poll interval and attempts, and a fetch to use in tests.
 * @returns The outcome; `pending` only if Sourcify is still working after every attempt.
 */
export async function verifyOnSourcify(
  chainId: number,
  address: string,
  body: VerifyRequestBody,
  {
    fetchImpl = fetch,
    intervalMs = 3000,
    attempts = 40,
  }: { fetchImpl?: Fetch; intervalMs?: number; attempts?: number } = {},
): Promise<VerificationOutcome> {
  const submit = await fetchImpl(`${SOURCIFY_API}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    return { state: "failed", message: `Sourcify refused the request: ${submit.status} ${await submit.text()}` };
  }
  const { verificationId } = (await submit.json()) as { verificationId: string };

  for (let attempt = 0; attempt < attempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const poll = await fetchImpl(`${SOURCIFY_API}/v2/verify/${verificationId}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!poll.ok) continue;
    const outcome = interpretJob(await poll.json());
    if (outcome.state !== "pending") return outcome;
  }
  return { state: "pending" };
}
