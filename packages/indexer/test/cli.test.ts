import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeConfig, main } from "../src/index.js";
import { loadConfig } from "../src/config.js";

/** Captures CLI output so assertions can read what an operator would see. */
function capture() {
  const lines: string[] = [];
  return { sink: (line: string) => lines.push(line), text: () => lines.join("\n") };
}

describe("main", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.INDEXER_TOPIC_IDS;
    delete process.env.PASSPORT_REGISTRY_ADDRESS;
    delete process.env.HEDERA_NETWORK;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("prints usage and fails when given no command", () => {
    const { sink, text } = capture();
    expect(main([], sink)).toBe(1);
    expect(text()).toContain("yarn indexer:dev");
  });

  it("prints usage and succeeds for an explicit help request", () => {
    for (const flag of ["help", "--help", "-h"]) {
      const { sink, text } = capture();
      expect(main([flag], sink)).toBe(0);
      expect(text()).toContain("product-passport indexer");
    }
  });

  it("rejects an unknown command and shows usage", () => {
    const { sink, text } = capture();
    expect(main(["frobnicate"], sink)).toBe(1);
    expect(text()).toContain('Unknown command "frobnicate"');
  });

  it("refuses to start when nothing is configured to index", () => {
    const { sink, text } = capture();
    expect(main(["dev"], sink)).toBe(1);
    expect(text()).toContain("Nothing to index");
    expect(text()).toContain("yarn passport:bootstrap");
  });

  it("accepts a known command once a topic is configured", () => {
    process.env.INDEXER_TOPIC_IDS = "0.0.12345";
    const { sink, text } = capture();
    expect(main(["dev"], sink)).toBe(0);
    expect(text()).toContain("0.0.12345");
  });

  it("reports a malformed environment instead of throwing", () => {
    process.env.INDEXER_TOPIC_IDS = "0.0.1";
    process.env.HEDERA_NETWORK = "devnet";
    const { sink, text } = capture();
    expect(main(["dev"], sink)).toBe(1);
    expect(text()).toContain("Configuration error");
  });
});

describe("describeConfig", () => {
  it("names the sqlite file when no DATABASE_URL is set", () => {
    expect(describeConfig(loadConfig({ INDEXER_TOPIC_IDS: "0.0.1" }))).toContain("sqlite ./data/passport.db");
  });

  it("names postgres when DATABASE_URL is set", () => {
    const config = loadConfig({ INDEXER_TOPIC_IDS: "0.0.1", DATABASE_URL: "postgres://x/y" });
    expect(describeConfig(config)).toContain("postgres (DATABASE_URL)");
  });

  it("says so plainly when there is no index target", () => {
    expect(describeConfig(loadConfig({}))).toContain("nothing configured");
  });
});
