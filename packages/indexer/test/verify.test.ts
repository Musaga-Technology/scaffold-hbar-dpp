import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleRoute } from "../src/api.js";
import { MirrorNodeClient } from "../src/mirror.js";
import {
  createTopicDiscovery,
  decodeProductRegisteredData,
  decodeRegistryLogs,
  resolveTopicIds,
} from "../src/discover.js";
import { pollOnce } from "../src/poller.js";
import { reconcileAll } from "../src/reconcile.js";
import { createMemoryStore } from "../src/store/index.js";
import type { IndexStore } from "../src/store/index.js";
import { formatVerifyReport, verifyAgainstReplay } from "../src/verify.js";
import { createFakeMirror } from "./helpers/fakeMirror.js";

const CLEAN_TOPIC = "0.0.6666666666";
const FORGED_TOPIC = "0.0.7777777777";
const TOPICS = [CLEAN_TOPIC, FORGED_TOPIC];

describe("verifyAgainstReplay", () => {
  let store: IndexStore;

  beforeEach(async () => {
    store = await createMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it("passes when the live index matches a clean rebuild", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, TOPICS);
    await reconcileAll(store, client);

    const report = await verifyAgainstReplay(store, client, TOPICS);

    expect(report.ok).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(report.liveEvents).toBe(report.replayedEvents);
    expect(formatVerifyReport(report)).toContain("matches a clean rebuild");
  });

  it("reports the forged serial as a finding, not as an index fault", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, TOPICS);
    await reconcileAll(store, client);

    const report = await verifyAgainstReplay(store, client, TOPICS);

    expect(report.ok).toBe(true);
    expect(report.discrepancies).toEqual([2]);

    const text = formatVerifyReport(report);
    expect(text).toContain("custody discrepancies on serial(s): 2");
    expect(text).toContain("findings about the data, not faults in the index");
  });

  it("catches an index row the ledger cannot account for", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, TOPICS);
    await reconcileAll(store, client);

    // Something wrote an event the mirror node has no record of.
    await store.upsertEvent({
      topicId: CLEAN_TOPIC,
      sequenceNumber: 99,
      consensusTimestamp: "9999.000000000",
      serial: 1,
      type: "product.shipped",
      hashValid: true,
    });

    const report = await verifyAgainstReplay(store, client, TOPICS);

    expect(report.ok).toBe(false);
    expect(report.mismatches).toContainEqual({
      kind: "event",
      key: `${CLEAN_TOPIC}#99`,
      field: "*",
      live: "present",
      replayed: "missing",
    });
    expect(formatVerifyReport(report)).toContain("does not match the ledger");
  });

  it("catches an index row that was tampered with in place", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, TOPICS);
    await reconcileAll(store, client);

    const events = await store.listEvents(1);
    await store.upsertEvent({
      topicId: events[0]!.topicId,
      sequenceNumber: events[0]!.sequenceNumber,
      consensusTimestamp: events[0]!.consensusTimestamp,
      type: "product.recycled",
      hashValid: true,
    });

    const report = await verifyAgainstReplay(store, client, TOPICS);

    expect(report.ok).toBe(false);
    expect(report.mismatches.some(m => m.field === "type")).toBe(true);
  });

  it("catches a missing row", async () => {
    const { client } = createFakeMirror();
    // Live index was never populated at all.
    const report = await verifyAgainstReplay(store, client, TOPICS);

    expect(report.ok).toBe(false);
    expect(report.liveEvents).toBe(0);
    expect(report.replayedEvents).toBeGreaterThan(0);
    expect(report.mismatches.every(m => m.live === "missing")).toBe(true);
  });
});

describe("index API routes", () => {
  let store: IndexStore;

  beforeEach(async () => {
    store = await createMemoryStore();
    const { client } = createFakeMirror();
    await pollOnce(store, client, TOPICS);
    await reconcileAll(store, client);
  });

  afterEach(async () => {
    await store.close();
  });

  it("serves health", async () => {
    expect(await handleRoute(store, "/health")).toEqual({ status: 200, body: { ok: true } });
  });

  it("serves stats", async () => {
    const { status, body } = await handleRoute(store, "/stats");
    expect(status).toBe(200);
    expect(body).toMatchObject({ products: 2, verified: 1, discrepancies: 1 });
  });

  it("serves the product list", async () => {
    const { status, body } = await handleRoute(store, "/api/passport/products");
    expect(status).toBe(200);
    expect((body as { products: unknown[] }).products).toHaveLength(2);
  });

  it("serves one passport with its events parsed", async () => {
    const { status, body } = await handleRoute(store, "/api/passport/products/1");
    expect(status).toBe(200);

    const payload = body as { product: { serial: number }; events: Array<{ payload: unknown }> };
    expect(payload.product.serial).toBe(1);
    expect(payload.events).toHaveLength(5);
    expect(payload.events[0]!.payload).toMatchObject({ category: "battery" });
  });

  it("serves a passport's events", async () => {
    const { status, body } = await handleRoute(store, "/api/passport/products/2/events");
    expect(status).toBe(200);
    expect((body as { events: unknown[] }).events).toHaveLength(4);
  });

  it("404s an unknown serial and an unknown route", async () => {
    expect((await handleRoute(store, "/api/passport/products/404")).status).toBe(404);
    expect((await handleRoute(store, "/nope")).status).toBe(404);
  });
});

/** Encodes a ProductRegistered log body carrying a topic id. */
function encodeLogData(topicId: string): string {
  const bytes = Buffer.from(topicId, "utf8");
  const offset = (64).toString(16).padStart(64, "0");
  const productHash = "ab".repeat(32);
  const length = bytes.length.toString(16).padStart(64, "0");
  const body = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  return `0x${offset}${productHash}${length}${body}`;
}

const TOPIC0 = "0x03f4aef151c70745f44693f202360f2e4b8c4a7d4b13373a9fb6f9ccfab2bb2a";

describe("topic discovery", () => {
  /** ABI-encodes (string topicId, bytes32 productHash) as the log body. */

  it("decodes a topic id out of the log body", () => {
    expect(decodeProductRegisteredData(encodeLogData("0.0.6666666666"))).toBe("0.0.6666666666");
  });

  it("returns nothing for data that is not shaped like the event", () => {
    expect(decodeProductRegisteredData("0x")).toBeUndefined();
    expect(decodeProductRegisteredData("0x" + "00".repeat(96))).toBeUndefined();
    expect(decodeProductRegisteredData(encodeLogData("not-a-topic-id"))).toBeUndefined();
  });

  it("reads serial and issuer from the indexed topics", () => {
    const discovered = decodeRegistryLogs([
      {
        address: "0xreg",
        data: encodeLogData("0.0.6666666666"),
        topics: [TOPIC0, `0x${"0".repeat(63)}1`, `0x${"0".repeat(24)}${"11".repeat(20)}`],
        timestamp: "1000.000000000",
      },
    ]);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({ serial: 1, topicId: "0.0.6666666666" });
    expect(discovered[0]!.issuer).toBe(`0x${"11".repeat(20)}`);
  });

  it("ignores logs from other events", () => {
    expect(
      decodeRegistryLogs([
        {
          address: "0xreg",
          data: encodeLogData("0.0.6666666666"),
          topics: [`0x${"ff".repeat(32)}`, `0x${"0".repeat(63)}1`],
          timestamp: "1000.000000000",
        },
      ]),
    ).toEqual([]);
  });

  it("prefers explicitly configured topics over discovery", async () => {
    const { client, requests } = createFakeMirror();
    const topics = await resolveTopicIds(client, ["0.0.1", "0.0.2"], "0xregistry");

    expect(topics).toEqual(["0.0.1", "0.0.2"]);
    // Discovery is not even attempted when topics are pinned.
    expect(requests).toEqual([]);
  });

  it("returns nothing when there is neither a topic list nor a registry", async () => {
    const { client } = createFakeMirror();
    expect(await resolveTopicIds(client, [], undefined)).toEqual([]);
  });

  it("discovers topics from the registry's logs", async () => {
    const { client } = createFakeMirror({
      "/results/logs": {
        logs: [
          {
            address: "0xreg",
            data: encodeLogData("0.0.6666666666"),
            topics: [TOPIC0, `0x${"0".repeat(63)}1`],
            timestamp: "1000.000000000",
          },
          {
            address: "0xreg",
            data: encodeLogData("0.0.7777777777"),
            topics: [TOPIC0, `0x${"0".repeat(63)}2`],
            timestamp: "1001.000000000",
          },
        ],
      },
    });

    expect(await resolveTopicIds(client, [], "0xregistry")).toEqual(["0.0.6666666666", "0.0.7777777777"]);
  });

  it("follows pagination, so products past the first page of logs are still discovered", async () => {
    // Discovery used to read one page and stop. With other registry logs
    // (custody transfers, allow-list changes) filling that page, product 3
    // below would never have been indexed.
    const registration = (topic: string, serial: number, ts: string) => ({
      address: "0xreg",
      data: encodeLogData(topic),
      topics: [TOPIC0, `0x${serial.toString(16).padStart(64, "0")}`],
      timestamp: ts,
    });
    const noise = { address: "0xreg", data: "0x", topics: [`0x${"ab".repeat(32)}`], timestamp: "1.0" };
    const pages: Record<string, unknown> = {
      first: { logs: [registration("0.0.6666666666", 1, "1000.0"), noise], links: { next: "/page-2" } },
      "/page-2": { logs: [noise, noise], links: { next: "/page-3" } },
      "/page-3": { logs: [registration("0.0.8888888888", 3, "1002.0")], links: { next: null } },
    };
    const requested: string[] = [];
    const client = new MirrorNodeClient("https://mirror.example", async (url: string) => {
      const route = url.replace("https://mirror.example", "");
      requested.push(route);
      const body = route.includes("/results/logs") ? pages.first : pages[route];
      return { ok: true, status: 200, statusText: "OK", json: async () => body };
    });

    expect(await resolveTopicIds(client, [], "0xregistry")).toEqual(["0.0.6666666666", "0.0.8888888888"]);
    expect(requested).toHaveLength(3);
  });

  it("stops rather than looping forever on a pagination cycle", async () => {
    const client = new MirrorNodeClient("https://mirror.example", async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ logs: [], links: { next: "/same-page" } }),
    }));

    await expect(client.fetchContractLogs("0xregistry", 100, 5)).rejects.toThrow(/more than 500 logs/);
  });
});

describe("createTopicDiscovery", () => {
  it("reads only new logs on each pass, and remembers what it already found", async () => {
    const registration = (topic: string, serial: number, ts: string) => ({
      address: "0xreg",
      data: encodeLogData(topic),
      topics: [TOPIC0, `0x${serial.toString(16).padStart(64, "0")}`],
      timestamp: ts,
    });
    const history = [registration("0.0.6666666666", 1, "1000.000000001")];
    const requested: string[] = [];
    const client = new MirrorNodeClient("https://mirror.example", async (url: string) => {
      requested.push(url);
      const after = url.match(/timestamp=gt:([\d.]+)/)?.[1];
      const logs = history.filter(log => !after || Number(log.timestamp) > Number(after));
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ logs, links: { next: null } }) };
    });

    const discover = createTopicDiscovery(client, [], "0xregistry");
    expect(await discover()).toEqual(["0.0.6666666666"]);
    expect(requested[0]).not.toContain("timestamp=");

    // A product registered while the indexer is running.
    history.push(registration("0.0.8888888888", 2, "1005.000000000"));
    expect(await discover()).toEqual(["0.0.6666666666", "0.0.8888888888"]);
    expect(requested[1]).toContain("timestamp=gt:1000.000000001");

    // Nothing new: the list holds, and the query starts after the latest log.
    expect(await discover()).toEqual(["0.0.6666666666", "0.0.8888888888"]);
    expect(requested[2]).toContain("timestamp=gt:1005.000000000");
  });

  it("uses an explicit topic list without consulting the registry", async () => {
    const client = new MirrorNodeClient("https://mirror.example", async () => {
      throw new Error("the registry should not be read");
    });
    expect(await createTopicDiscovery(client, ["0.0.1"], "0xregistry")()).toEqual(["0.0.1"]);
  });
});
