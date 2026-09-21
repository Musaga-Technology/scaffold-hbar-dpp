/**
 * Server-side Hedera client.
 *
 * SERVER ONLY. The operator key signs HCS submissions; it must never be sent to
 * a browser, and nothing here may be imported from a client component. The
 * environment variables are deliberately un-prefixed — a `NEXT_PUBLIC_` operator
 * key would be inlined into the client bundle for anyone to read.
 *
 * Every route that needs the operator calls `requireOperator()`, which fails
 * with a typed, actionable error instead of throwing a driver exception at a
 * developer who simply has not configured `.env` yet.
 */
import { Client, PrivateKey } from "@hiero-ledger/sdk";
import "server-only";

export type HederaNetwork = "testnet" | "mainnet" | "previewnet";

/** Resolved operator credentials. */
export interface OperatorConfig {
  accountId: string;
  privateKey: PrivateKey;
  network: HederaNetwork;
}

/** Why the operator could not be resolved, in a form a route can return as JSON. */
export class OperatorUnavailableError extends Error {
  readonly code = "operator_unavailable";
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "OperatorUnavailableError";
  }
}

function parseNetwork(raw: string | undefined): HederaNetwork {
  const value = (raw ?? "testnet").toLowerCase();
  if (value === "testnet" || value === "mainnet" || value === "previewnet") return value;
  throw new OperatorUnavailableError(`HEDERA_NETWORK must be testnet, mainnet or previewnet — got "${raw}".`);
}

/**
 * Reports whether an operator is configured.
 *
 * Used to decide whether a write route is available at all, so the UI can
 * explain what to configure rather than offering a button that will fail.
 */
export function hasOperatorKey(): boolean {
  return Boolean(process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_PRIVATE_KEY);
}

/**
 * Resolves operator credentials.
 *
 * @returns The configured operator.
 * @throws OperatorUnavailableError when the environment is incomplete or invalid.
 */
export function requireOperator(): OperatorConfig {
  const accountId = process.env.HEDERA_OPERATOR_ID;
  const privateKeyRaw = process.env.HEDERA_OPERATOR_PRIVATE_KEY;

  if (!accountId || !privateKeyRaw) {
    throw new OperatorUnavailableError(
      "This route needs a Hedera operator. Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_PRIVATE_KEY " +
        "in packages/nextjs/.env.local (server-side only — never prefix them with NEXT_PUBLIC_), " +
        "or run `yarn passport:bootstrap` which writes the public values for you.",
    );
  }

  if (!/^\d+\.\d+\.\d+$/.test(accountId)) {
    throw new OperatorUnavailableError(`HEDERA_OPERATOR_ID must look like 0.0.x — got "${accountId}".`);
  }

  let privateKey: PrivateKey;
  try {
    // ECDSA is required for the EVM flows this template uses throughout.
    privateKey = PrivateKey.fromStringECDSA(privateKeyRaw);
  } catch {
    throw new OperatorUnavailableError(
      "HEDERA_OPERATOR_PRIVATE_KEY is not a valid ECDSA private key. EVM flows need an ECDSA account; " +
        "create one at https://portal.hedera.com.",
    );
  }

  return { accountId, privateKey, network: parseNetwork(process.env.HEDERA_NETWORK) };
}

/**
 * Builds a Hedera client for the configured operator.
 *
 * Callers must `close()` it. A client holds gRPC connections, and a route that
 * leaks them will exhaust the runtime's socket budget under load.
 *
 * @returns A client bound to the operator, and the operator itself.
 */
export function createOperatorClient(): { client: Client; operator: OperatorConfig } {
  const operator = requireOperator();
  const client = Client.forName(operator.network).setOperator(operator.accountId, operator.privateKey);
  return { client, operator };
}

/** The network the app is pointed at, for links and labels. */
export function publicNetwork(): HederaNetwork {
  const raw = process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? process.env.HEDERA_NETWORK;
  const value = (raw ?? "testnet").toLowerCase();
  return value === "mainnet" || value === "previewnet" ? value : "testnet";
}
