/**
 * Mirror node REST client.
 *
 * The mirror node is the indexer's only read source. Everything this template
 * shows a user is ultimately derived from these calls, which is what makes the
 * index rebuildable and `indexer:verify` meaningful.
 */
import type { MirrorTopicMessage } from "./events/index.js";

/** A page of topic messages. */
export interface TopicMessagePage {
  messages: MirrorTopicMessage[];
  /** Next page path supplied by the mirror node, when there is more. */
  nextLink?: string;
}

/** One NFT transfer as the mirror node reports it. */
export interface MirrorNftTransaction {
  consensus_timestamp: string;
  transaction_id?: string;
  type?: string;
  sender_account_id?: string | null;
  receiver_account_id?: string | null;
  is_approval?: boolean;
}

/** A contract log entry, used to discover topics from ProductRegistered events. */
export interface MirrorContractLog {
  address: string;
  data: string;
  topics: string[];
  consensus_timestamp: string;
  transaction_hash?: string;
}

/** Minimal HTTP surface, so tests can supply a fetch that never touches a network. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export class MirrorNodeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  /**
   * Performs a GET against the mirror node.
   *
   * @param route Path beginning with a slash, or a full next-link path.
   * @returns Parsed JSON, or undefined when the entity does not exist.
   * @throws On any non-404 error, so a real outage is never mistaken for absence.
   */
  async get<T>(route: string): Promise<T | undefined> {
    const response = await this.fetchImpl(`${this.baseUrl}${route}`);
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Mirror node ${route} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  /**
   * Fetches one page of topic messages after a sequence number.
   *
   * @param topicId Topic to read.
   * @param afterSequence Exclusive lower bound; 0 reads from the start.
   * @param limit Page size.
   */
  async fetchTopicMessages(topicId: string, afterSequence = 0, limit = 100): Promise<TopicMessagePage> {
    // Sequence numbers are 1-based, so `gt:0` is not "from the beginning" — the
    // mirror node rejects it outright with "Invalid parameter: sequencenumber".
    // Reading from scratch means sending no filter at all.
    const filter = afterSequence > 0 ? `sequencenumber=gt:${afterSequence}&` : "";
    const route = `/api/v1/topics/${topicId}/messages?${filter}limit=${limit}&order=asc`;
    const page = await this.get<{ messages?: MirrorTopicMessage[]; links?: { next?: string | null } }>(route);

    return {
      messages: page?.messages ?? [],
      nextLink: page?.links?.next ?? undefined,
    };
  }

  /**
   * Fetches every message on a topic after a sequence number, following pagination.
   *
   * @param topicId Topic to read.
   * @param afterSequence Exclusive lower bound.
   * @param maxPages Safety stop, so a pathological topic cannot spin forever.
   */
  async fetchAllTopicMessages(topicId: string, afterSequence = 0, maxPages = 100): Promise<MirrorTopicMessage[]> {
    const collected: MirrorTopicMessage[] = [];
    let cursor = afterSequence;

    for (let page = 0; page < maxPages; page += 1) {
      const { messages } = await this.fetchTopicMessages(topicId, cursor);
      if (messages.length === 0) break;

      collected.push(...messages);
      const highest = messages.reduce((max, message) => Math.max(max, message.sequence_number), cursor);
      // Guard against a mirror node that ignores the filter: without this a
      // page that repeats the same sequence numbers would loop forever.
      if (highest <= cursor) break;
      cursor = highest;
    }

    return collected;
  }

  /**
   * Fetches the transfer history of one NFT serial.
   *
   * This is the custody truth that HCS claims are reconciled against.
   */
  async fetchNftTransactions(tokenId: string, serial: number, limit = 100): Promise<MirrorNftTransaction[]> {
    const route = `/api/v1/tokens/${tokenId}/nfts/${serial}/transactions?limit=${limit}&order=asc`;
    const page = await this.get<{ transactions?: MirrorNftTransaction[] }>(route);
    return page?.transactions ?? [];
  }

  /** Reads the current holder of a serial. */
  async fetchNftHolder(tokenId: string, serial: number): Promise<string | undefined> {
    const nft = await this.get<{ account_id?: string }>(`/api/v1/tokens/${tokenId}/nfts/${serial}`);
    return nft?.account_id ?? undefined;
  }

  /** Resolves an EVM token address to its `0.0.x` id. */
  async fetchTokenId(evmAddress: string): Promise<string | undefined> {
    const normalized = evmAddress.startsWith("0x") ? evmAddress : `0x${evmAddress}`;
    const token = await this.get<{ token_id?: string }>(`/api/v1/tokens/${normalized}`);
    return token?.token_id;
  }

  /** Reads contract logs, used to discover product topics from registry events. */
  async fetchContractLogs(contractAddress: string, limit = 100): Promise<MirrorContractLog[]> {
    const route = `/api/v1/contracts/${contractAddress}/results/logs?limit=${limit}&order=asc`;
    const page = await this.get<{ logs?: MirrorContractLog[] }>(route);
    return page?.logs ?? [];
  }
}
