/**
 * Topic discovery from the registry's `ProductRegistered` logs.
 *
 * An operator who only knows the registry address should not have to hand-copy
 * topic ids. The registry emits one log per product carrying its topic, so the
 * mirror node's contract-log endpoint is enough to find every topic to follow.
 *
 * The log is decoded by hand rather than by pulling a full ABI library into the
 * indexer: the event signature is fixed and known, the layout is 64 bytes of
 * head plus a length-prefixed string, and the indexer otherwise has no need of
 * an EVM codec.
 */
import type { MirrorContractLog, MirrorNodeClient } from "./mirror.js";

/**
 * keccak256("ProductRegistered(int64,string,bytes32,address)").
 *
 * Topic 0 of the log. Pinned as a constant so a signature change in the
 * contract surfaces as "no topics discovered" rather than as silent mis-parsing.
 */
export const PRODUCT_REGISTERED_TOPIC0 = "0x03f4aef151c70745f44693f202360f2e4b8c4a7d4b13373a9fb6f9ccfab2bb2a";

/** A product found in the registry's logs. */
export interface DiscoveredProduct {
  serial: number;
  topicId: string;
  issuer?: string;
  consensusTimestamp: string;
}

function stripHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

/** Reads a 32-byte word as a bigint. */
function word(data: string, index: number): bigint {
  const slice = data.slice(index * 64, (index + 1) * 64);
  return slice.length === 64 ? BigInt(`0x${slice}`) : 0n;
}

/**
 * Decodes the non-indexed body of a `ProductRegistered` log.
 *
 * Layout: word 0 is the offset to the string, word 1 is productHash, and at the
 * offset sits the string length followed by its UTF-8 bytes.
 *
 * @param data Hex-encoded log data.
 * @returns The topic id, or undefined when the data does not have that shape.
 */
export function decodeProductRegisteredData(data: string): string | undefined {
  const hex = stripHex(data);
  if (hex.length < 192) return undefined;

  const offsetBytes = Number(word(hex, 0));
  if (!Number.isFinite(offsetBytes) || offsetBytes % 32 !== 0) return undefined;

  const lengthIndex = offsetBytes / 32;
  const length = Number(word(hex, lengthIndex));
  if (!Number.isFinite(length) || length <= 0 || length > 128) return undefined;

  const start = (lengthIndex + 1) * 64;
  const stringHex = hex.slice(start, start + length * 2);
  if (stringHex.length < length * 2) return undefined;

  const decoded = Buffer.from(stringHex, "hex").toString("utf8");
  return /^\d+\.\d+\.\d+$/.test(decoded) ? decoded : undefined;
}

/**
 * Turns registry logs into the products they announced.
 *
 * @param logs Contract logs from the mirror node.
 * @returns One entry per decodable `ProductRegistered` log.
 */
export function decodeRegistryLogs(logs: readonly MirrorContractLog[]): DiscoveredProduct[] {
  const discovered: DiscoveredProduct[] = [];

  for (const log of logs) {
    const [topic0, serialTopic, issuerTopic] = log.topics ?? [];
    if (!topic0 || topic0.toLowerCase() !== PRODUCT_REGISTERED_TOPIC0.toLowerCase()) continue;

    const topicId = decodeProductRegisteredData(log.data ?? "");
    if (!topicId || !serialTopic) continue;

    const serial = Number(BigInt(serialTopic));
    if (!Number.isInteger(serial) || serial < 1) continue;

    discovered.push({
      serial,
      topicId,
      issuer: issuerTopic ? `0x${stripHex(issuerTopic).slice(24)}` : undefined,
      consensusTimestamp: log.consensus_timestamp,
    });
  }

  return discovered;
}

/**
 * Discovers the topics to index.
 *
 * Explicitly configured topics always win; the registry is only consulted when
 * none are given, so an operator can always pin exactly what gets indexed.
 *
 * @param mirror Mirror node client.
 * @param configuredTopicIds Topics from INDEXER_TOPIC_IDS.
 * @param registryAddress Registry contract address, when configured.
 * @returns Topic ids to poll, in a stable order.
 */
export async function resolveTopicIds(
  mirror: MirrorNodeClient,
  configuredTopicIds: readonly string[],
  registryAddress?: string,
): Promise<string[]> {
  if (configuredTopicIds.length > 0) return [...configuredTopicIds];
  if (!registryAddress) return [];

  const logs = await mirror.fetchContractLogs(registryAddress);
  const topics = new Set(decodeRegistryLogs(logs).map(product => product.topicId));
  return [...topics].sort();
}
