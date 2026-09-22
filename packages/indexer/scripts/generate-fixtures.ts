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
import { verifyPendingAttachments, type FetchLike as GatewayFetch } from "../src/attachments.js";
import { buildCar } from "../src/content/ipfs.js";
import { createHash } from "node:crypto";
import { MirrorNodeClient, type FetchLike } from "../src/mirror.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, "..", "test", "fixtures");

/**
 * Entity ids for the demo fixtures.
 *
 * Repdigits in an unallocated range, chosen for two reasons. They do not resolve
 * on Hedera testnet, and — more importantly — they cannot collide with somebody
 * else's account. Plausible-looking low ids were used here originally; 0.0.1001
 * and 0.0.3003 turned out to be real testnet accounts, so the demo passport was
 * naming a stranger as the holder of a fictional battery. Verified 404 across
 * accounts, tokens and topics before being adopted.
 */
const TOKEN_ID = "0.0.5555555555";
const CLEAN_TOPIC = "0.0.6666666666";
const FORGED_TOPIC = "0.0.7777777777";
const MALFORMED_TOPIC = "0.0.8888888888";

/**
 * Base instant for the fixture timeline.
 *
 * Derived from an ISO date rather than written as a raw epoch: a hand-typed
 * epoch was previously a year out, which put the demo battery's shipping event
 * ten months before its own manufacturing date.
 */
const BASE_ISO = "2026-09-21T10:00:00Z";
const BASE_EPOCH = Math.floor(Date.parse(BASE_ISO) / 1000);

/**
 * Demo documents.
 *
 * `INTACT` is a certificate whose CID and committed hash both name the same
 * bytes. The textile passport shows the failure content addressing actually
 * catches: the issuer points at the lab's real report, which says 41% recycled,
 * but commits the hash of a better-looking version saying 68% that was never
 * published. Content behind a CID cannot change, so this is not a document
 * "replaced later" — the attestation contradicted itself from the start, and
 * the indexer says so. That case is why the storage integration is
 * load-bearing rather than decorative, so it is in the fixtures where a
 * reviewer can see it.
 *
 * The CIDs are the real CIDs of these bodies, computed below, so the demo is
 * internally consistent — anyone can recompute them. Issuers are fictional, for
 * the same reason the entity ids are: a made-up certificate should not carry a
 * real certification body's name.
 */
const INTACT_BODY =
  "CONFORMITY CERTIFICATE\nEU 2023/1542 Annex XIII\nPowerCell 72 kWh EV Pack\nIssued by Example Test Laboratory";
const PERMANENT_BODY =
  "END-OF-LIFE DECLARATION\nRecycling route registered\nRetention required beyond product lifetime";
/** What the lab actually reported, and what the passport's CID points at. */
const REFERENCED_BODY =
  "FIBRE COMPOSITION REPORT\n41% recycled polyester, 59% virgin polyester\nIssued by Example Textile Lab";
/** The version the issuer committed a hash of. Never published anywhere. */
const CLAIMED_BODY =
  "FIBRE COMPOSITION REPORT\n68% recycled polyester, 32% organic cotton\nIssued by Example Textile Lab";

const INTACT = await buildCar(new TextEncoder().encode(INTACT_BODY));
const REFERENCED = await buildCar(new TextEncoder().encode(REFERENCED_BODY));
/** An Arweave transaction id: 43 base64url characters. Unallocated. */
const PERMANENT_AR_ID = "kP3xMiEMRD9Wn9Q0vSHpbQ9GXXbQXn3KfvOaNT9Zsxk";

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const ISSUER = "0.0.1111111111";
const DISTRIBUTOR = "0.0.2222222222";
const RETAILER = "0.0.3333333333";

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
      payload: {
        result: "pass",
        inspector: "Example Test Laboratory",
        attachments: [
          {
            cid: INTACT.cid,
            hash: sha256Hex(INTACT_BODY),
            name: "conformity-certificate.txt",
            type: "text/plain",
          },
          {
            // Stored permanently, because an end-of-life declaration has to
            // outlive whoever is currently paying to pin things.
            protocol: "arweave",
            cid: PERMANENT_AR_ID,
            hash: sha256Hex(PERMANENT_BODY),
            name: "end-of-life-declaration.txt",
            type: "text/plain",
          },
        ],
      },
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
        category: "textile",
        name: "Coastal Parka, recycled shell",
        manufacturer: "Vestland Apparel",
        fibreComposition: "68% recycled polyester, 32% organic cotton",
        recycledContentPct: 68,
        manufacturedAt: "2026-07-20",
        originCountry: "PT",
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
      payload: { from: "Porto Mill 4", to: "Hamburg DC", carrier: "DB Schenker" },
    },
  },
  {
    offsetSeconds: 90,
    input: {
      type: "product.inspected",
      serial: 2,
      tokenId: TOKEN_ID,
      actor: ISSUER,
      payload: {
        result: "pass",
        inspector: "In-house QA",
        // The CID names the lab's real report; the hash is of the version the
        // issuer wished it said.
        attachments: [
          {
            cid: REFERENCED.cid,
            hash: sha256Hex(CLAIMED_BODY),
            name: "fibre-composition-report.txt",
            type: "text/plain",
          },
        ],
      },
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
      topic_id: MALFORMED_TOPIC,
    },
  ],
  links: { next: null },
};

const files: Array<[string, unknown]> = [
  [`topic-${CLEAN_TOPIC}-messages.json`, cleanMessages],
  [`topic-${FORGED_TOPIC}-messages.json`, forgedMessages],
  [`topic-${MALFORMED_TOPIC}-messages.json`, malformedMessages],
  [`nft-${TOKEN_ID}-1-transactions.json`, cleanTransfers],
  [`nft-${TOKEN_ID}-2-transactions.json`, forgedTransfers],
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

// An honest trustless gateway: CARs for IPFS, raw bytes for Arweave. Nothing
// here is rigged — the textile report fails because of what the issuer
// committed, and the same verifier that runs in production says so.
const gatewayBodies: Record<string, Uint8Array> = {
  [INTACT.cid]: INTACT.car,
  [REFERENCED.cid]: REFERENCED.car,
  [PERMANENT_AR_ID]: new TextEncoder().encode(PERMANENT_BODY),
};
const gatewayFetch: GatewayFetch = async (url: string) => {
  // IPFS serves under /ipfs/<cid>?format=car; Arweave serves the id at the root.
  const id = url.includes("/ipfs/") ? (url.split("/ipfs/")[1]?.split("?")[0] ?? "") : (url.split("/").pop() ?? "");
  const body = gatewayBodies[id];
  if (body === undefined) {
    return { ok: false, status: 404, statusText: "Not Found", arrayBuffer: async () => new ArrayBuffer(0) };
  }
  return { ok: true, status: 200, statusText: "OK", arrayBuffer: async () => body.slice().buffer as ArrayBuffer };
};

await verifyPendingAttachments(
  store,
  { ipfs: ["https://trustless-gateway.link"], arweave: "https://arweave.net" },
  gatewayFetch,
);
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
    attachments: view.attachments,
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
