import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeConfig, main, parseArgs } from "../src/index.js";
import { loadConfig } from "../src/config.js";

/** Captures CLI output so assertions can read what an operator would see. */
function capture() {
  const lines: string[] = [];
  return { sink: (line: string) => lines.push(line), text: () => lines.join("\n") };
}

describe("parseArgs", () => {
  it("asks for help and fails when given no command", () => {
    expect(parseArgs([])).toEqual({ kind: "help", exitCode: 1 });
  });

  it("asks for help and succeeds for an explicit help request", () => {
    for (const flag of ["help", "--help", "-h"]) {
      expect(parseArgs([flag])).toEqual({ kind: "help", exitCode: 0 });
    }
  });

  it("accepts each supported command", () => {
    for (const command of ["dev", "replay", "verify"] as const) {
      expect(parseArgs([command])).toEqual({ kind: "run", command });
    }
  });

  it("rejects anything else", () => {
    const parsed = parseArgs(["frobnicate"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain('Unknown command "frobnicate"');
    expect(parsed.exitCode).toBe(1);
  });
});

describe("main", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.INDEXER_TOPIC_IDS;
    delete process.env.PASSPORT_REGISTRY_ADDRESS;
    delete process.env.HEDERA_NETWORK;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("prints usage and fails when given no command", async () => {
    const { sink, text } = capture();
    expect(await main([], sink)).toBe(1);
    expect(text()).toContain("yarn indexer:dev");
  });

  it("prints usage and succeeds for an explicit help request", async () => {
    const { sink, text } = capture();
    expect(await main(["--help"], sink)).toBe(0);
    expect(text()).toContain("product-passport indexer");
  });

  it("rejects an unknown command and shows usage", async () => {
    const { sink, text } = capture();
    expect(await main(["frobnicate"], sink)).toBe(1);
    expect(text()).toContain('Unknown command "frobnicate"');
  });

  it("refuses a one-shot command when nothing is configured to index", async () => {
    const { sink, text } = capture();
    expect(await main(["replay"], sink)).toBe(1);
    expect(text()).toContain("Nothing to index");
    expect(text()).toContain("yarn passport:bootstrap");
  });

  it("reports a malformed environment instead of throwing", async () => {
    process.env.INDEXER_TOPIC_IDS = "0.0.1";
    process.env.HEDERA_NETWORK = "devnet";
    const { sink, text } = capture();
    expect(await main(["dev"], sink)).toBe(1);
    expect(text()).toContain("Configuration error");
  });

  it("uses Postgres when DATABASE_URL is set, rather than silently falling back to SQLite", async () => {
    process.env.INDEXER_TOPIC_IDS = "0.0.1";
    // Port 1 refuses immediately, so this asserts the routing without needing a
    // live database: a SQLite fallback would have succeeded and reported on the
    // file instead, which is the failure mode worth guarding against.
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/passport";
    const { sink, text } = capture();

    expect(await main(["verify"], sink)).toBe(1);
    expect(text()).toContain("postgres (DATABASE_URL)");
    expect(text()).not.toContain("sqlite");
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
