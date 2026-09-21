import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BUFFER_HBAR,
  DEFAULT_COLLECTION_FEE_HBAR,
  DEPLOY_COST_HBAR,
  TOPIC_AND_EVENTS_COST_HBAR,
  assessFunding,
  describeShortfall,
  formatHbar,
  hbarToTinybar,
  resolveCollectionFeeHbar,
  tinybarToHbar,
} from "../scripts/lib/preflight";
import { emptyState, readState, remainingSteps, writeState, type PassportState } from "../scripts/lib/state";
import { buildEvent, canonicalize, sha256Hex } from "../scripts/lib/events";
import { demoProductHash } from "../scripts/lib/demoProduct";
import { hashscan, resolveNetwork } from "../scripts/lib/hedera";

const ALL_WORK = {
  needsDeploy: true,
  needsCollection: true,
  needsTopic: true,
  collectionFeeHbar: DEFAULT_COLLECTION_FEE_HBAR,
};

const FULL_COST = DEPLOY_COST_HBAR + DEFAULT_COLLECTION_FEE_HBAR + TOPIC_AND_EVENTS_COST_HBAR + BUFFER_HBAR;

describe("bootstrap preflight", function () {
  it("charges for every step on a first run", function () {
    const assessment = assessFunding(100, ALL_WORK);

    expect(assessment.requiredHbar).to.equal(FULL_COST);
    expect(assessment.sufficient).to.equal(true);
    expect(assessment.shortfallHbar).to.equal(0);
    expect(assessment.breakdown.map(line => line.label)).to.deep.equal([
      "deploy PassportRegistry",
      "HTS collection creation",
      "HCS topic + demo events",
      "buffer",
    ]);
  });

  it("does not charge again for work that already succeeded", function () {
    const assessment = assessFunding(10, { ...ALL_WORK, needsDeploy: false, needsCollection: false });

    expect(assessment.requiredHbar).to.equal(TOPIC_AND_EVENTS_COST_HBAR + BUFFER_HBAR);
    expect(assessment.sufficient).to.equal(true);
  });

  it("asks for nothing when there is nothing left to do", function () {
    const assessment = assessFunding(0, {
      needsDeploy: false,
      needsCollection: false,
      needsTopic: false,
      collectionFeeHbar: DEFAULT_COLLECTION_FEE_HBAR,
    });

    expect(assessment.requiredHbar).to.equal(0);
    expect(assessment.sufficient).to.equal(true);
    expect(assessment.breakdown).to.deep.equal([]);
  });

  it("reports the exact shortfall rather than a vague failure", function () {
    const assessment = assessFunding(3, ALL_WORK);

    expect(assessment.sufficient).to.equal(false);
    expect(assessment.shortfallHbar).to.equal(FULL_COST - 3);

    const message = describeShortfall(3, assessment);
    expect(message).to.contain("have 3 HBAR");
    expect(message).to.contain(`need ${formatHbar(FULL_COST)}`);
    expect(message).to.contain("https://portal.hedera.com/faucet");
    expect(message).to.contain("HTS collection creation");
  });

  it("treats a balance exactly equal to the requirement as sufficient", function () {
    expect(assessFunding(FULL_COST, ALL_WORK).sufficient).to.equal(true);
    expect(assessFunding(FULL_COST - 0.00000001, ALL_WORK).sufficient).to.equal(false);
  });

  it("honours a custom collection fee", function () {
    const assessment = assessFunding(100, { ...ALL_WORK, collectionFeeHbar: 35 });
    expect(assessment.requiredHbar).to.equal(DEPLOY_COST_HBAR + 35 + TOPIC_AND_EVENTS_COST_HBAR + BUFFER_HBAR);
  });

  it("reads the collection fee from the environment and rejects nonsense", function () {
    expect(resolveCollectionFeeHbar(undefined)).to.equal(DEFAULT_COLLECTION_FEE_HBAR);
    expect(resolveCollectionFeeHbar("  ")).to.equal(DEFAULT_COLLECTION_FEE_HBAR);
    expect(resolveCollectionFeeHbar("30")).to.equal(30);
    expect(() => resolveCollectionFeeHbar("0")).to.throw(/positive number/);
    expect(() => resolveCollectionFeeHbar("-5")).to.throw(/positive number/);
    expect(() => resolveCollectionFeeHbar("lots")).to.throw(/positive number/);
  });

  it("round-trips HBAR and tinybars", function () {
    expect(hbarToTinybar(1)).to.equal(100_000_000n);
    expect(tinybarToHbar(100_000_000n)).to.equal(1);
    expect(tinybarToHbar(hbarToTinybar(20.5))).to.equal(20.5);
  });
});

describe("bootstrap state", function () {
  let dir: string;
  let statePath: string;

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "passport-state-"));
    statePath = path.join(dir, "passport.state.json");
  });

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty state when no file exists", function () {
    const state = readState(statePath, "hederaTestnet");
    expect(state).to.deep.equal(emptyState("hederaTestnet"));
  });

  it("round-trips a written state and stamps updatedAt", function () {
    const written: PassportState = {
      version: 1,
      network: "hederaTestnet",
      registryAddress: "0xabc",
      tokenId: "0.0.5005",
      serial: 1,
      topicId: "0.0.6006",
    };
    writeState(statePath, written);

    const read = readState(statePath, "hederaTestnet");
    expect(read.registryAddress).to.equal("0xabc");
    expect(read.tokenId).to.equal("0.0.5005");
    expect(read.updatedAt).to.be.a("string");
  });

  it("ignores state recorded for a different network", function () {
    const warnings: string[] = [];
    writeState(statePath, { version: 1, network: "hederaMainnet", registryAddress: "0xmainnet" });

    const state = readState(statePath, "hederaTestnet", message => warnings.push(message));
    expect(state.registryAddress).to.equal(undefined);
    expect(warnings.join(" ")).to.contain("hederaMainnet");
  });

  it("ignores an unparseable state file instead of crashing the run", function () {
    const warnings: string[] = [];
    fs.writeFileSync(statePath, "{ not json", "utf8");

    const state = readState(statePath, "hederaTestnet", message => warnings.push(message));
    expect(state).to.deep.equal(emptyState("hederaTestnet"));
    expect(warnings.join(" ")).to.contain("unreadable");
  });

  it("derives which steps still have to run", function () {
    expect(remainingSteps(emptyState("hederaTestnet"))).to.deep.equal({
      needsDeploy: true,
      needsCollection: true,
      needsTopic: true,
      needsProduct: true,
    });

    expect(
      remainingSteps({
        version: 1,
        network: "hederaTestnet",
        registryAddress: "0xabc",
        collectionAddress: "0xdef",
        topicId: "0.0.1",
        serial: 1,
      }),
    ).to.deep.equal({
      needsDeploy: false,
      needsCollection: false,
      needsTopic: false,
      needsProduct: false,
    });
  });

  it("treats serial 0 as registered rather than absent", function () {
    // Guards against a truthiness check creeping in: HTS serials start at 1, but
    // a `!state.serial` test would also re-register serial 0 forever.
    const steps = remainingSteps({ version: 1, network: "hederaTestnet", serial: 0 });
    expect(steps.needsProduct).to.equal(false);
  });
});

describe("passport events", function () {
  it("canonicalizes with sorted keys and no whitespace", function () {
    expect(canonicalize({ b: 1, a: 2 })).to.equal('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 } })).to.equal('{"z":{"x":2,"y":1}}');
    expect(canonicalize([3, { b: 1, a: 2 }])).to.equal('[3,{"a":2,"b":1}]');
  });

  it("hashes the same payload identically regardless of key order", function () {
    const first = sha256Hex(canonicalize({ result: "pass", inspector: "TUV" }));
    const second = sha256Hex(canonicalize({ inspector: "TUV", result: "pass" }));
    expect(first).to.equal(second);
    expect(first).to.match(/^[0-9a-f]{64}$/);
  });

  it("builds an event carrying the hash of its own payload", function () {
    const { event, message } = buildEvent({
      type: "product.inspected",
      serial: 1,
      tokenId: "0.0.5005",
      actor: "0xabc",
      payload: { result: "pass" },
      ts: new Date("2026-09-21T10:00:00.000Z"),
    });

    expect(event.v).to.equal(1);
    expect(event.ts).to.equal("2026-09-21T10:00:00.000Z");
    expect(event.payloadHash).to.equal(sha256Hex('{"result":"pass"}'));
    expect(message).to.contain('"type":"product.inspected"');
    expect(Buffer.byteLength(message, "utf8")).to.be.lessThan(1024);
  });

  it("omits optional fields rather than emitting nulls that cost bytes", function () {
    const { message } = buildEvent({
      type: "product.shipped",
      serial: 1,
      tokenId: "0.0.5005",
      actor: "0xabc",
      payload: {},
    });
    expect(message).to.not.contain('"ref"');
    expect(message).to.not.contain('"prev"');
  });

  it("refuses to submit a message over the 1024-byte HCS limit", function () {
    expect(() =>
      buildEvent({
        type: "product.inspected",
        serial: 1,
        tokenId: "0.0.5005",
        actor: "0xabc",
        payload: { report: "x".repeat(1100) },
      }),
    ).to.throw(/over the 1024-byte limit/);
  });

  it("gives the demo product a stable hash", function () {
    expect(demoProductHash()).to.equal(demoProductHash());
    expect(demoProductHash()).to.match(/^[0-9a-f]{64}$/);
  });
});

describe("network resolution", function () {
  it("maps hardhat network names and chain ids to Hedera networks", function () {
    expect(resolveNetwork("hederaTestnet")).to.equal("testnet");
    expect(resolveNetwork("hederaMainnet")).to.equal("mainnet");
    expect(resolveNetwork("unknown", 296)).to.equal("testnet");
    expect(resolveNetwork("unknown", 295)).to.equal("mainnet");
  });

  it("refuses a non-Hedera network with an actionable message", function () {
    expect(() => resolveNetwork("hardhat")).to.throw(/--network hederaTestnet/);
    expect(() => resolveNetwork("localhost", 31337)).to.throw(/not a Hedera network/);
  });

  it("builds HashScan links for every entity the bootstrap prints", function () {
    expect(hashscan.contract("testnet", "0xabc")).to.equal("https://hashscan.io/testnet/contract/0xabc");
    expect(hashscan.token("testnet", "0.0.5005")).to.equal("https://hashscan.io/testnet/token/0.0.5005");
    expect(hashscan.serial("testnet", "0.0.5005", 1)).to.equal("https://hashscan.io/testnet/token/0.0.5005/1");
    expect(hashscan.topic("mainnet", "0.0.6006")).to.equal("https://hashscan.io/mainnet/topic/0.0.6006");
  });
});
