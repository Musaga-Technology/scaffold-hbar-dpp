import { describe, expect, it } from "vitest";
import { MIRROR_NODE_URLS, hasIndexTarget, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("runs with no configuration at all", () => {
    const config = loadConfig({});

    expect(config.network).toBe("testnet");
    expect(config.mirrorNodeUrl).toBe(MIRROR_NODE_URLS.testnet);
    expect(config.topicIds).toEqual([]);
    expect(config.pollMs).toBe(5000);
    expect(config.dbPath).toBe("./data/passport.db");
    expect(config.port).toBe(3001);
  });

  it("picks the mirror node for the selected network", () => {
    expect(loadConfig({ HEDERA_NETWORK: "mainnet" }).mirrorNodeUrl).toBe(MIRROR_NODE_URLS.mainnet);
    expect(loadConfig({ HEDERA_NETWORK: "MAINNET" }).network).toBe("mainnet");
  });

  it("rejects an unknown network rather than silently defaulting", () => {
    expect(() => loadConfig({ HEDERA_NETWORK: "devnet" })).toThrow(/HEDERA_NETWORK must be one of/);
  });

  it("lets MIRROR_NODE_URL override the network default and strips trailing slashes", () => {
    const config = loadConfig({ MIRROR_NODE_URL: "https://mirror.example.com///" });
    expect(config.mirrorNodeUrl).toBe("https://mirror.example.com");
  });

  it("parses a topic list, ignoring blanks and whitespace", () => {
    expect(loadConfig({ INDEXER_TOPIC_IDS: " 0.0.1 , ,0.0.2, " }).topicIds).toEqual(["0.0.1", "0.0.2"]);
  });

  it("rejects a non-positive poll interval", () => {
    expect(() => loadConfig({ INDEXER_POLL_MS: "0" })).toThrow(/INDEXER_POLL_MS/);
    expect(() => loadConfig({ INDEXER_POLL_MS: "-1" })).toThrow(/INDEXER_POLL_MS/);
    expect(() => loadConfig({ INDEXER_POLL_MS: "abc" })).toThrow(/INDEXER_POLL_MS/);
  });

  it("prefers Postgres when DATABASE_URL is set", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/passport" });
    expect(config.databaseUrl).toBe("postgres://localhost/passport");
  });
});

describe("hasIndexTarget", () => {
  it("is false when neither topics nor a registry are configured", () => {
    expect(hasIndexTarget(loadConfig({}))).toBe(false);
  });

  it("is true with explicit topics", () => {
    expect(hasIndexTarget(loadConfig({ INDEXER_TOPIC_IDS: "0.0.1" }))).toBe(true);
  });

  it("is true with a registry to discover topics from", () => {
    expect(hasIndexTarget(loadConfig({ PASSPORT_REGISTRY_ADDRESS: "0xabc" }))).toBe(true);
  });
});
