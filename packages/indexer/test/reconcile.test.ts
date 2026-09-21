import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MATCH_WINDOW_SECONDS, reconcileAll, reconcileSerial } from "../src/reconcile.js";
import { pollOnce } from "../src/poller.js";
import { createMemoryStore } from "../src/store/index.js";
import type { EventRow, IndexStore, NftTransferRow } from "../src/store/index.js";
import { createFakeMirror } from "./helpers/fakeMirror.js";

const TOKEN_ID = "0.0.5005";
const CLEAN_TOPIC = "0.0.6006";
const FORGED_TOPIC = "0.0.6007";

/** Builds an event row with sensible defaults, overridden per test. */
function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    topicId: CLEAN_TOPIC,
    sequenceNumber: 1,
    consensusTimestamp: "1000.000000000",
    serial: 1,
    tokenId: TOKEN_ID,
    type: "custody.transferred",
    actor: "0.0.1001",
    payloadJson: JSON.stringify({ from: "0.0.1001", to: "0.0.2002" }),
    payloadHash: "a".repeat(64),
    ref: null,
    hashValid: true,
    malformedReason: null,
    rawHash: null,
    reconciliation: "pending",
    reconciliationNote: null,
    ...overrides,
  };
}

/** Builds a transfer row with sensible defaults, overridden per test. */
function transfer(overrides: Partial<NftTransferRow> = {}): NftTransferRow {
  return {
    tokenId: TOKEN_ID,
    serial: 1,
    consensusTimestamp: "1000.000000000",
    sender: "0.0.1001",
    receiver: "0.0.2002",
    transactionId: "0.0.1001@1000.000000000",
    isMint: false,
    ...overrides,
  };
}

describe("reconcileSerial", () => {
  it("reconciles a custody claim that names its transaction", () => {
    const { verdicts, status } = reconcileSerial([event({ ref: "0.0.1001@1000.000000000" })], [transfer()]);

    expect(verdicts[0]!.reconciliation).toBe("reconciled");
    expect(status).toBe("verified");
  });

  it("reconciles by parties and time when no ref is given", () => {
    const { verdicts } = reconcileSerial([event({ ref: null })], [transfer()]);
    expect(verdicts[0]!.reconciliation).toBe("reconciled");
  });

  it("flags a claim with no matching transfer as a discrepancy", () => {
    const { verdicts, status } = reconcileSerial([event({ ref: null })], []);

    expect(verdicts[0]!.reconciliation).toBe("discrepancy");
    expect(verdicts[0]!.note).toContain("no matching NFT transfer");
    expect(status).toBe("discrepancy");
  });

  it("flags a claim whose parties disagree with the chain", () => {
    const { verdicts } = reconcileSerial(
      [event({ ref: null, payloadJson: JSON.stringify({ from: "0.0.1001", to: "0.0.9999" }) })],
      [transfer()],
    );
    expect(verdicts[0]!.reconciliation).toBe("discrepancy");
  });

  it("accepts a transfer just inside the match window and rejects one just outside", () => {
    const inside = reconcileSerial(
      [event({ ref: null })],
      [transfer({ consensusTimestamp: `${1000 + MATCH_WINDOW_SECONDS}.000000000` })],
    );
    expect(inside.verdicts[0]!.reconciliation).toBe("reconciled");

    const outside = reconcileSerial(
      [event({ ref: null })],
      [transfer({ consensusTimestamp: `${1000 + MATCH_WINDOW_SECONDS + 1}.000000000` })],
    );
    expect(outside.verdicts[0]!.reconciliation).toBe("discrepancy");
  });

  it("treats an altered payload as a discrepancy above all other checks", () => {
    const { verdicts, status } = reconcileSerial(
      [event({ hashValid: false, ref: "0.0.1001@1000.000000000" })],
      [transfer()],
    );

    expect(verdicts[0]!.reconciliation).toBe("discrepancy");
    expect(verdicts[0]!.note).toContain("altered after submission");
    expect(status).toBe("discrepancy");
  });

  it("says pending, not verified, when a claim cannot be compared", () => {
    // EVM-address parties cannot be matched against mirror node account ids.
    const { verdicts, status } = reconcileSerial(
      [event({ ref: null, payloadJson: JSON.stringify({ from: "0xaaa", to: "0xbbb" }) })],
      [transfer()],
    );

    expect(verdicts[0]!.reconciliation).toBe("pending");
    expect(verdicts[0]!.note).toContain("cannot be compared");
    expect(status).toBe("pending");
  });

  it("confirms a registration against the mint", () => {
    const { verdicts, status } = reconcileSerial(
      [event({ type: "product.registered", ref: null, payloadJson: "{}" })],
      [transfer({ isMint: true, sender: null })],
    );

    expect(verdicts[0]!.reconciliation).toBe("reconciled");
    expect(verdicts[0]!.note).toContain("Mint confirmed");
    expect(status).toBe("verified");
  });

  it("holds a registration pending while the mirror node lags", () => {
    const { verdicts, status } = reconcileSerial(
      [event({ type: "product.registered", ref: null, payloadJson: "{}" })],
      [],
    );

    expect(verdicts[0]!.reconciliation).toBe("pending");
    expect(status).toBe("pending");
  });

  it("leaves non-custody events alone", () => {
    const { verdicts, status } = reconcileSerial(
      [event({ type: "product.inspected", payloadJson: JSON.stringify({ result: "pass" }) })],
      [],
    );

    expect(verdicts[0]!.reconciliation).toBe("n/a");
    expect(status).toBe("verified");
  });

  it("does not let a malformed message fail an otherwise sound passport", () => {
    const { verdicts, status } = reconcileSerial(
      [event({ type: "malformed", malformedReason: "invalid-json", hashValid: true, payloadJson: null })],
      [],
    );

    expect(verdicts[0]!.reconciliation).toBe("n/a");
    expect(verdicts[0]!.note).toContain("could not be decoded");
    expect(status).toBe("verified");
  });

  it("lets one discrepancy outrank many good claims", () => {
    const { status } = reconcileSerial(
      [
        event({ sequenceNumber: 1, ref: "0.0.1001@1000.000000000" }),
        event({ sequenceNumber: 2, ref: null, payloadJson: JSON.stringify({ from: "0.0.1", to: "0.0.2" }) }),
      ],
      [transfer()],
    );
    expect(status).toBe("discrepancy");
  });

  it("takes the current holder from the chain, not from the claims", () => {
    const { currentHolder } = reconcileSerial(
      [event()],
      [
        transfer({ consensusTimestamp: "900.000000000", isMint: true, sender: null, receiver: "0.0.1001" }),
        transfer({ consensusTimestamp: "1000.000000000", receiver: "0.0.2002" }),
      ],
    );
    expect(currentHolder).toBe("0.0.2002");
  });
});

describe("reconcileAll against recorded fixtures", () => {
  let store: IndexStore;

  beforeEach(async () => {
    store = await createMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it("verifies the clean passport and flags the forged one", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, [CLEAN_TOPIC, FORGED_TOPIC]);

    const summaries = await reconcileAll(store, client);

    expect(summaries).toEqual([
      { serial: 1, status: "verified", discrepancies: 0 },
      { serial: 2, status: "discrepancy", discrepancies: 1 },
    ]);
  });

  it("names the offending event and explains why", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, [FORGED_TOPIC]);
    await reconcileAll(store, client);

    const events = await store.listEvents(2);
    const flagged = events.filter(e => e.reconciliation === "discrepancy");

    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.type).toBe("custody.transferred");
    expect(flagged[0]!.reconciliationNote).toContain("no matching NFT transfer");
  });

  it("records the chain's holder on the verified passport", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, [CLEAN_TOPIC]);
    await reconcileAll(store, client);

    const product = await store.getProduct(1);
    expect(product?.status).toBe("verified");
    expect(product?.currentHolder).toBe("0.0.3003");
    expect(product?.lastReconciledAt).toBeTruthy();
  });

  it("is idempotent: reconciling twice gives the same verdicts", async () => {
    const { client } = createFakeMirror();
    await pollOnce(store, client, [CLEAN_TOPIC, FORGED_TOPIC]);

    const first = await reconcileAll(store, client);
    const second = await reconcileAll(store, client);

    expect(second).toEqual(first);
  });
});
