/**
 * Regenerates the recorded mirror-node fixtures used by the indexer tests and by
 * the app's offline demo mode.
 *
 * Run with: yarn workspace @sh/indexer exec tsx scripts/generate-fixtures.ts
 *
 * The fixtures are shaped exactly like real mirror node responses, and their
 * payload hashes are produced by the same `buildEvent` the bootstrap uses — so a
 * change to canonicalisation shows up here rather than only in production.
 *
 * Serial 1 is a clean passport. Serial 2 carries a forged custody claim: an HCS
 * message asserting a transfer that never happened on-chain. It exists so the
 * discrepancy path is exercised by tests and visible in the UI, which is the
 * point acceptance assertion C3 checks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildEvent, type BuildEventInput } from "../src/events/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, "..", "test", "fixtures");

const TOKEN_ID = "0.0.5005";
const CLEAN_TOPIC = "0.0.6006";
const FORGED_TOPIC = "0.0.6007";

const ISSUER = "0.0.1001";
const DISTRIBUTOR = "0.0.2002";
const RETAILER = "0.0.3003";

/** Consensus timestamps are seconds.nanos strings, ascending. */
function consensusAt(offsetSeconds: number): string {
  return `${1758448800 + offsetSeconds}.000000000`;
}

function transactionId(account: string, offsetSeconds: number): string {
  return `${account}@${1758448800 + offsetSeconds}.000000000`;
}

interface MessageSpec {
  input: Omit<BuildEventInput, "ts">;
  offsetSeconds: number;
}

/** Builds a mirror-node topic message page from event specs. */
function buildMessages(topicId: string, specs: MessageSpec[]) {
  return {
    messages: specs.map((spec, index) => {
      const { message } = buildEvent({ ...spec.input, ts: new Date((1758448800 + spec.offsetSeconds) * 1000) });
      return {
        chunk_info: null,
        consensus_timestamp: consensusAt(spec.offsetSeconds),
        message: Buffer.from(message, "utf8").toString("base64"),
        payer_account_id: ISSUER,
        running_hash: `0x${"ab".repeat(24)}`,
        running_hash_version: 3,
        sequence_number: index + 1,
        topic_id: topicId,
      };
    }),
    links: { next: null },
  };
}

// ---------------------------------------------------------------- serial 1
const cleanMessages = buildMessages(CLEAN_TOPIC, [
  {
    offsetSeconds: 0,
    input: {
      type: "product.registered",
      serial: 1,
      tokenId: TOKEN_ID,
      actor: ISSUER,
      payload: {
        category: "battery",
        name: "PowerCell 72 kWh EV Pack",
        manufacturer: "Northwind Cells",
        batteryCategory: "EV",
        chemistry: "LFP",
        ratedCapacityKwh: 72,
        manufacturedAt: "2026-07-14",
        originCountry: "PL",
      },
      ref: transactionId(ISSUER, 0),
    },
  },
  {
    offsetSeconds: 60,
    input: {
      type: "product.shipped",
      serial: 1,
      tokenId: TOKEN_ID,
      actor: ISSUER,
      payload: { from: "Gdansk Plant 2", to: "Rotterdam DC", carrier: "Maersk", waybill: "MAEU-4471903" },
    },
  },
  {
    offsetSeconds: 120,
    input: {
      type: "custody.transferred",
      serial: 1,
      tokenId: TOKEN_ID,
      actor: ISSUER,
      payload: { from: ISSUER, to: DISTRIBUTOR, reason: "Handover to distributor" },
      ref: transactionId(ISSUER, 120),
    },
  },
  {
    offsetSeconds: 180,
    input: {
      type: "product.inspected",
      serial: 1,
      tokenId: TOKEN_ID,
      actor: DISTRIBUTOR,
      payload: { result: "pass", inspector: "TUV Rheinland", note: "State of health 100%." },
    },
  },
  {
    offsetSeconds: 240,
    input: {
      type: "custody.transferred",
      serial: 1,
      tokenId: TOKEN_ID,
      actor: DISTRIBUTOR,
      payload: { from: DISTRIBUTOR, to: RETAILER, reason: "Sold to retailer" },
      ref: transactionId(DISTRIBUTOR, 240),
    },
  },
]);

/** Transfers that corroborate every custody claim above. */
const cleanTransfers = {
  transactions: [
    {
      consensus_timestamp: consensusAt(0),
      transaction_id: transactionId(ISSUER, 0),
      type: "TOKENMINT",
      sender_account_id: null,
      receiver_account_id: ISSUER,
      is_approval: false,
    },
    {
      consensus_timestamp: consensusAt(120),
      transaction_id: transactionId(ISSUER, 120),
      type: "CRYPTOTRANSFER",
      sender_account_id: ISSUER,
      receiver_account_id: DISTRIBUTOR,
      is_approval: false,
    },
    {
      consensus_timestamp: consensusAt(240),
      transaction_id: transactionId(DISTRIBUTOR, 240),
      type: "CRYPTOTRANSFER",
      sender_account_id: DISTRIBUTOR,
      receiver_account_id: RETAILER,
      is_approval: false,
    },
  ],
  links: { next: null },
};

// ---------------------------------------------------------------- serial 2
const forgedMessages = buildMessages(FORGED_TOPIC, [
  {
    offsetSeconds: 0,
    input: {
      type: "product.registered",
      serial: 2,
      tokenId: TOKEN_ID,
      actor: ISSUER,
      payload: {
        category: "battery",
        name: "PowerCell 48 kWh LMT Pack",
        manufacturer: "Northwind Cells",
        batteryCategory: "LMT",
        chemistry: "NMC",
        ratedCapacityKwh: 48,
        manufacturedAt: "2026-07-20",
        originCountry: "PL",
      },
      ref: transactionId(ISSUER, 0),
    },
  },
  {
    offsetSeconds: 60,
    input: {
      type: "product.shipped",
      serial: 2,
      tokenId: TOKEN_ID,
      actor: ISSUER,
      payload: { from: "Gdansk Plant 2", to: "Hamburg DC", carrier: "DB Schenker" },
    },
  },
  {
    // The forgery: a custody claim with no matching NFT transfer on-chain.
    offsetSeconds: 120,
    input: {
      type: "custody.transferred",
      serial: 2,
      tokenId: TOKEN_ID,
      actor: ISSUER,
      payload: { from: ISSUER, to: RETAILER, reason: "Claimed handover that never happened" },
      ref: transactionId(ISSUER, 999),
    },
  },
]);

/** Only the mint. The custody claim above is uncorroborated. */
const forgedTransfers = {
  transactions: [
    {
      consensus_timestamp: consensusAt(0),
      transaction_id: transactionId(ISSUER, 0),
      type: "TOKENMINT",
      sender_account_id: null,
      receiver_account_id: ISSUER,
      is_approval: false,
    },
  ],
  links: { next: null },
};

/** A topic message that is not valid JSON, to exercise the malformed path. */
const malformedMessages = {
  messages: [
    {
      chunk_info: null,
      consensus_timestamp: consensusAt(0),
      message: Buffer.from("this is not json", "utf8").toString("base64"),
      payer_account_id: ISSUER,
      running_hash: `0x${"cd".repeat(24)}`,
      running_hash_version: 3,
      sequence_number: 1,
      topic_id: "0.0.6008",
    },
  ],
  links: { next: null },
};

const files: Array<[string, unknown]> = [
  ["topic-0.0.6006-messages.json", cleanMessages],
  ["topic-0.0.6007-messages.json", forgedMessages],
  ["topic-0.0.6008-messages.json", malformedMessages],
  ["nft-0.0.5005-1-transactions.json", cleanTransfers],
  ["nft-0.0.5005-2-transactions.json", forgedTransfers],
];

fs.mkdirSync(FIXTURE_DIR, { recursive: true });
for (const [name, content] of files) {
  fs.writeFileSync(path.join(FIXTURE_DIR, name), `${JSON.stringify(content, null, 2)}\n`, "utf8");
  console.log(`wrote test/fixtures/${name}`);
}
