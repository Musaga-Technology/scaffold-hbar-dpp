/**
 * Mirror node and HashScan helpers shared by the bootstrap and status scripts.
 *
 * The mirror node is the only read source: it is the same surface the indexer
 * uses, so what these scripts report is what the indexer will see.
 */

/** Hardhat network name to Hedera network name. */
const NETWORK_BY_HARDHAT_NAME: Record<string, "testnet" | "mainnet" | "previewnet"> = {
  hederaTestnet: "testnet",
  hederaMainnet: "mainnet",
  hederaPreviewnet: "previewnet",
};

/** Chain id to Hedera network name. */
const NETWORK_BY_CHAIN_ID: Record<number, "testnet" | "mainnet" | "previewnet"> = {
  295: "mainnet",
  296: "testnet",
  297: "previewnet",
};

export type HederaNetwork = "testnet" | "mainnet" | "previewnet";

/**
 * Resolves the Hedera network from a hardhat network name or chain id.
 *
 * @param hardhatNetwork Hardhat network name (e.g. `hederaTestnet`).
 * @param chainId Chain id reported by the provider, used as a fallback.
 * @returns The Hedera network name.
 * @throws When neither identifies a known Hedera network.
 */
export function resolveNetwork(hardhatNetwork: string, chainId?: number): HederaNetwork {
  const byName = NETWORK_BY_HARDHAT_NAME[hardhatNetwork];
  if (byName) return byName;

  const byChain = chainId === undefined ? undefined : NETWORK_BY_CHAIN_ID[chainId];
  if (byChain) return byChain;

  throw new Error(`"${hardhatNetwork}" is not a Hedera network. Run with --network hederaTestnet (or hederaMainnet).`);
}

/** Mirror node REST base URL for a network. */
export function mirrorNodeUrl(network: HederaNetwork): string {
  return `https://${network}.mirrornode.hedera.com`;
}

/** HashScan base URL for a network. */
export function hashscanUrl(network: HederaNetwork): string {
  return `https://hashscan.io/${network}`;
}

/** HashScan link builders, one per entity kind the bootstrap prints. */
export const hashscan = {
  contract: (network: HederaNetwork, address: string) => `${hashscanUrl(network)}/contract/${address}`,
  token: (network: HederaNetwork, tokenId: string) => `${hashscanUrl(network)}/token/${tokenId}`,
  serial: (network: HederaNetwork, tokenId: string, serial: number) =>
    `${hashscanUrl(network)}/token/${tokenId}/${serial}`,
  topic: (network: HederaNetwork, topicId: string) => `${hashscanUrl(network)}/topic/${topicId}`,
  transaction: (network: HederaNetwork, transactionId: string) =>
    `${hashscanUrl(network)}/transaction/${transactionId}`,
  account: (network: HederaNetwork, accountId: string) => `${hashscanUrl(network)}/account/${accountId}`,
};

/** Minimal shape of a mirror node account record. */
export interface MirrorAccount {
  account: string;
  evm_address: string | null;
  balance: { balance: number } | null;
}

/**
 * Performs a mirror node GET, returning undefined on 404.
 *
 * @param baseUrl Mirror node base URL.
 * @param route REST path beginning with a slash.
 * @returns Parsed JSON, or undefined when the entity does not exist.
 * @throws On any non-404 error response, so real failures are not mistaken for absence.
 */
export async function mirrorGet<T>(baseUrl: string, route: string): Promise<T | undefined> {
  const response = await fetch(`${baseUrl}${route}`);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Mirror node ${route} failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * Looks up a Hedera account by its EVM address.
 *
 * Used to derive the operator account id from the deployer's ECDSA key, so a
 * developer who has only run `yarn hardhat:account:generate` does not have to
 * find and copy their `0.0.x` id by hand.
 *
 * @param baseUrl Mirror node base URL.
 * @param evmAddress Deployer address, with or without the 0x prefix.
 * @returns The account record, or undefined when the account is not yet funded.
 */
export async function fetchAccountByEvmAddress(
  baseUrl: string,
  evmAddress: string,
): Promise<MirrorAccount | undefined> {
  const normalized = evmAddress.startsWith("0x") ? evmAddress : `0x${evmAddress}`;
  return mirrorGet<MirrorAccount>(baseUrl, `/api/v1/accounts/${normalized}`);
}

/**
 * Converts an EVM contract address into the Hedera entity id the mirror node reports.
 *
 * HTS returns the collection as an EVM address; HashScan, the SDK and the
 * indexer all want `0.0.x`, and the mirror node is the authority on the mapping.
 *
 * @param baseUrl Mirror node base URL.
 * @param evmAddress Token address returned by the system contract.
 * @returns The `0.0.x` token id, or undefined when the mirror node has not caught up.
 */
export async function fetchTokenIdByAddress(baseUrl: string, evmAddress: string): Promise<string | undefined> {
  const normalized = evmAddress.startsWith("0x") ? evmAddress : `0x${evmAddress}`;
  const token = await mirrorGet<{ token_id: string }>(baseUrl, `/api/v1/tokens/${normalized}`);
  return token?.token_id;
}

/**
 * Polls until the mirror node reports an entity, or the attempts run out.
 *
 * The mirror node trails consensus by a second or two, so reading straight back
 * after a write often 404s. Callers treat a timeout as "not yet", never as "missing".
 *
 * @param probe Function returning the entity, or undefined when not yet present.
 * @param attempts Maximum number of polls.
 * @param delayMs Delay between polls.
 * @returns The entity, or undefined if it never appeared.
 */
export async function waitForMirror<T>(
  probe: () => Promise<T | undefined>,
  attempts = 10,
  delayMs = 1500,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await probe();
    if (result !== undefined) return result;
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return undefined;
}
