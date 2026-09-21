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
import { pollOnce } from "../src/poller.js";
import { reconcileAll } from "../src/reconcile.js";
import { createMemoryStore } from "../src/store/index.js";
import { MirrorNodeClient, type FetchLike } from "../src/mirror.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, "..", "test", "fixtures");

const TOKEN_ID = "0.0.5005";
const CLEAN_TOPIC = "0.0.6006";
const FORGED_TOPIC = "0.0.6007";

/**
 * Base instant for the fixture timeline.
 *
 * Derived from an ISO date rather than written as a raw epoch: a hand-typed
 * epoch was previously a year out, which put the demo battery's shipping event
 * ten months before its own manufacturing date.
 */
const BASE_ISO = "2026-09-21T10:00:00Z";
const BASE_EPOCH = Math.floor(Date.parse(BASE_ISO) / 1000);

const ISSUER = "0.0.1001";
const DISTRIBUTOR = "0.0.2002";
const RETAILER = "0.0.3003";

/** Consensus timestamps are seconds.nanos strings, ascending. */
function consensusAt(offsetSeconds: number): string {
  return `${BASE_EPOCH + offsetSeconds}.000000000`;
}

function transactionId(account: string, offsetSeconds: number): string {
  return `${account}@${BASE_EPOCH + offsetSeconds}.000000000`;
}

interface MessageSpec {
  input: Omit<BuildEventInput, "ts">;
  offsetSeconds: number;
}

/** Builds a mirror-node topic message page from event specs. */
function buildMessages(topicId: string, specs: MessageSpec[]) {
  return {
    messages: specs.map((spec, index) => {
      const { message } = buildEvent({ ...spec.input, ts: new Date((BASE_EPOCH + spec.offsetSeconds) * 1000) });
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

// ---------------------------------------------------------------------------
// The app's offline demo fixtures.
//
// Produced by running the real poller and reconciler over the mirror-node
// fixtures above, then serialising the passport view. The app therefore renders
// exactly the shape the index API returns - demo mode cannot drift away from
// live mode, because the same code builds both.
// ---------------------------------------------------------------------------

const APP_FIXTURE_DIR = path.join(HERE, "..", "..", "nextjs", "fixtures");

/** Serves the files just written, so the pipeline runs without a network. */
const localFetch: FetchLike = async (url: string) => {
  const route = url.replace("https://testnet.mirrornode.hedera.com", "");
  const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
  const notFound = () => ({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) });

  const topic = route.match(/^\/api\/v1\/topics\/([\d.]+)\/messages/);
  if (topic) {
    const file = path.join(FIXTURE_DIR, `topic-${topic[1]}-messages.json`);
    if (!fs.existsSync(file)) return notFound();
    const page = JSON.parse(fs.readFileSync(file, "utf8")) as { messages: Array<{ sequence_number: number }> };
    const after = Number(route.match(/sequencenumber=gt:(\d+)/)?.[1] ?? 0);
    return ok({ messages: page.messages.filter(m => m.sequence_number > after), links: { next: null } });
  }

  const nft = route.match(/^\/api\/v1\/tokens\/([\d.]+)\/nfts\/(\d+)\/transactions/);
  if (nft) {
    const file = path.join(FIXTURE_DIR, `nft-${nft[1]}-${nft[2]}-transactions.json`);
    if (!fs.existsSync(file)) return notFound();
    return ok(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  return notFound();
};

const store = await createMemoryStore();
const mirror = new MirrorNodeClient("https://testnet.mirrornode.hedera.com", localFetch);

await pollOnce(store, mirror, [CLEAN_TOPIC, FORGED_TOPIC]);
await reconcileAll(store, mirror);

fs.mkdirSync(APP_FIXTURE_DIR, { recursive: true });

for (const [serial, name] of [
  [1, "demo-passport.json"],
  [2, "demo-passport-forged.json"],
] as const) {
  const view = await store.getPassport(serial);
  if (!view) throw new Error(`Expected serial ${serial} in the generated index.`);

  const payload = {
    $comment:
      "Generated by packages/indexer/scripts/generate-fixtures.ts from the real poller and reconciler. " +
      "Do not hand-edit - run the script instead. Serves the app's offline demo mode.",
    product: view.product,
    events: view.events.map(event => ({
      ...event,
      payload: event.payloadJson ? JSON.parse(event.payloadJson) : null,
    })),
    transfers: view.transfers,
  };

  fs.writeFileSync(path.join(APP_FIXTURE_DIR, name), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`wrote packages/nextjs/fixtures/${name}`);
}

fs.writeFileSync(
  path.join(APP_FIXTURE_DIR, "demo-stats.json"),
  `${JSON.stringify(await store.stats(), null, 2)}\n`,
  "utf8",
);
console.log("wrote packages/nextjs/fixtures/demo-stats.json");

await store.close();
