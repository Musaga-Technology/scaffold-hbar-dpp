import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "../src/store/index.js";
import type { IndexStore } from "../src/store/index.js";
import { pollOnce, pollTopic, syncTransfers } from "../src/poller.js";
import { createFakeMirror } from "./helpers/fakeMirror.js";

const TOKEN_ID = "0.0.5555555555";
const CLEAN_TOPIC = "0.0.6666666666";
const FORGED_TOPIC = "0.0.7777777777";
const MALFORMED_TOPIC = "0.0.8888888888";

describe("pollTopic", () => {
  let store: IndexStore;

  beforeEach(async () => {
    store = await createMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it("indexes a topic from scratch and advances the cursor", async () => {
    const { client } = createFakeMirror();
    const result = await pollTopic(store, client, CLEAN_TOPIC);

    expect(result.written).toBe(5);
    expect(result.malformed).toBe(0);
    expect(result.cursor).toBe(5);
    expect(await store.getCursor(CLEAN_TOPIC)).toBe(5);
  });

  it("lifts the registration into a product row", async () => {
    const { client } = createFakeMirror();
    await pollTopic(store, client, CLEAN_TOPIC);

    const product = await store.getProduct(1);
    expect(product?.tokenId).toBe(TOKEN_ID);
    expect(product?.topicId).toBe(CLEAN_TOPIC);
    expect(product?.category).toBe("battery");
    expect(product?.name).toBe("PowerCell 72 kWh EV Pack");
  });

  it("orders events by consensus timestamp", async () => {
    const { client } = createFakeMirror();
    await pollTopic(store, client, CLEAN_TOPIC);

    const events = await store.listEvents(1);
    expect(events.map(event => event.type)).toEqual([
      "product.registered",
      "product.shipped",
      "custody.transferred",
      "product.inspected",
      "custody.transferred",
    ]);
  });

  it("verifies each payload against its claimed hash", async () => {
    const { client } = createFakeMirror();
    await pollTopic(store, client, CLEAN_TOPIC);

    const events = await store.listEvents(1);
    expect(events.every(event => event.hashValid)).toBe(true);
  });

  it("marks custody and registration events pending until reconciled", async () => {
    const { client } = createFakeMirror();
    await pollTopic(store, client, CLEAN_TOPIC);

    const events = await store.listEvents(1);
    const byType = (type: string) => events.filter(event => event.type === type);

    expect(byType("custody.transferred").every(event => event.reconciliation === "pending")).toBe(true);
    expect(byType("product.registered").every(event => event.reconciliation === "pending")).toBe(true);
    // Events that make no custody claim need no reconciliation at all.
    expect(byType("product.shipped").every(event => event.reconciliation === "n/a")).toBe(true);
    expect(byType("product.inspected").every(event => event.reconciliation === "n/a")).toBe(true);
  });

  it("is idempotent: polling twice leaves the same rows", async () => {
    const { client } = createFakeMirror();
    await pollTopic(store, client, CLEAN_TOPIC);
    const first = await store.listEvents(1);

    const second = await pollTopic(store, client, CLEAN_TOPIC);
    const after = await store.listEvents(1);

    // Nothing new to read the second time, and no duplicate rows.
    expect(second.written).toBe(0);
    expect(after).toHaveLength(first.length);
    expect(after.map(e => e.sequenceNumber)).toEqual(first.map(e => e.sequenceNumber));
  });

  it("resumes from the cursor instead of re-reading the whole topic", async () => {
    const { client, requests } = createFakeMirror();
    await pollTopic(store, client, CLEAN_TOPIC);
    requests.length = 0;

    await pollTopic(store, client, CLEAN_TOPIC);
    expect(requests.some(route => route.includes("sequencenumber=gt:5"))).toBe(true);
  });

  it("records an undecodable message rather than dropping it", async () => {
    const { client } = createFakeMirror();
    const result = await pollTopic(store, client, MALFORMED_TOPIC);

    expect(result.written).toBe(1);
    expect(result.malformed).toBe(1);

    const events = await store.listEventsByTopic(MALFORMED_TOPIC);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("malformed");
    expect(events[0]!.malformedReason).toBe("invalid-json");
    // Even an unreadable message stays anchored by a hash of its bytes.
    expect(events[0]!.rawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(events[0]!.consensusTimestamp).toBeTruthy();
  });

  it("returns an empty result for a topic with no messages", async () => {
    const { client } = createFakeMirror();
    const result = await pollTopic(store, client, "0.0.9999");

    expect(result.written).toBe(0);
    expect(result.cursor).toBe(0);
  });

  it("polls several topics in one pass", async () => {
    const { client } = createFakeMirror();
    const results = await pollOnce(store, client, [CLEAN_TOPIC, FORGED_TOPIC]);

    expect(results.map(r => r.written)).toEqual([5, 3]);
    expect((await store.listProducts()).map(p => p.serial)).toEqual([1, 2]);
  });
});

describe("replay determinism", () => {
  it("produces identical rows when rebuilt from scratch", async () => {
    const { client } = createFakeMirror();

    const first = await createMemoryStore();
    await pollOnce(first, client, [CLEAN_TOPIC, FORGED_TOPIC]);
    const firstEvents = await first.listAllEvents();
    const firstProducts = await first.listProducts();
    await first.close();

    const second = await createMemoryStore();
    await pollOnce(second, client, [CLEAN_TOPIC, FORGED_TOPIC]);
    const secondEvents = await second.listAllEvents();
    const secondProducts = await second.listProducts();
    await second.close();

    // `id` is an autoincrement local to each database, so compare the content.
    const strip = (rows: Array<Record<string, unknown>>) => rows.map(({ id, ...rest }) => rest);

    expect(strip(secondEvents)).toEqual(strip(firstEvents));
    expect(secondProducts).toEqual(firstProducts);
  });
});

describe("syncTransfers", () => {
  let store: IndexStore;

  beforeEach(async () => {
    store = await createMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it("records the NFT transfer history, flagging the mint", async () => {
    const { client } = createFakeMirror();
    const count = await syncTransfers(store, client, TOKEN_ID, 1);

    expect(count).toBe(3);
    const transfers = await store.listTransfers(TOKEN_ID, 1);
    expect(transfers).toHaveLength(3);
    expect(transfers[0]!.isMint).toBe(true);
    expect(transfers[0]!.sender).toBeNull();
    expect(transfers[2]!.receiver).toBe("0.0.3333333333");
  });

  it("is idempotent", async () => {
    const { client } = createFakeMirror();
    await syncTransfers(store, client, TOKEN_ID, 1);
    await syncTransfers(store, client, TOKEN_ID, 1);

    expect(await store.listTransfers(TOKEN_ID, 1)).toHaveLength(3);
  });

  it("records only the mint for the forged serial", async () => {
    const { client } = createFakeMirror();
    await syncTransfers(store, client, TOKEN_ID, 2);

    const transfers = await store.listTransfers(TOKEN_ID, 2);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.isMint).toBe(true);
  });
});
