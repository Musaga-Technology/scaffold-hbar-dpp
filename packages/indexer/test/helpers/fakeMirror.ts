/**
 * A mirror node backed by recorded fixtures.
 *
 * Routes the same URL shapes the real client builds, so the tests exercise the
 * actual request construction — pagination filters included — rather than a
 * hand-stubbed client.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MirrorNodeClient, type FetchLike } from "../../src/mirror.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export const BASE_URL = "https://testnet.mirrornode.hedera.com";

function readFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

/** Records every path the client asked for, so tests can assert on them. */
export interface FakeMirror {
  client: MirrorNodeClient;
  requests: string[];
}

/**
 * Builds a mirror node client that serves fixtures.
 *
 * @param overrides Extra route handlers, keyed by a substring of the path.
 * @returns The client and the list of requested paths.
 */
export function createFakeMirror(overrides: Record<string, unknown> = {}): FakeMirror {
  const requests: string[] = [];

  const fetchImpl: FetchLike = async (url: string) => {
    const route = url.replace(BASE_URL, "");
    requests.push(route);

    const ok = (body: unknown) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    });
    const notFound = () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });

    for (const [needle, body] of Object.entries(overrides)) {
      if (route.includes(needle)) return ok(body);
    }

    // Topic messages, honouring the sequencenumber=gt: filter the client sends.
    const topicMatch = route.match(/^\/api\/v1\/topics\/([\d.]+)\/messages/);
    if (topicMatch) {
      const topicId = topicMatch[1]!;
      let page: { messages: Array<{ sequence_number: number }> };
      try {
        page = readFixture(`topic-${topicId}-messages.json`) as typeof page;
      } catch {
        return notFound();
      }
      const after = Number(route.match(/sequencenumber=gt:(\d+)/)?.[1] ?? 0);
      return ok({
        messages: page.messages.filter(message => message.sequence_number > after),
        links: { next: null },
      });
    }

    const nftTxMatch = route.match(/^\/api\/v1\/tokens\/([\d.]+)\/nfts\/(\d+)\/transactions/);
    if (nftTxMatch) {
      try {
        return ok(readFixture(`nft-${nftTxMatch[1]}-${nftTxMatch[2]}-transactions.json`));
      } catch {
        return notFound();
      }
    }

    return notFound();
  };

  return { client: new MirrorNodeClient(BASE_URL, fetchImpl), requests };
}
