import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_VERIFY_BYTES,
  recordAttachments,
  verifyAttachment,
  verifyPendingAttachments,
  type FetchLike,
} from "../src/attachments.js";
import {
  contentUri,
  gatewayUrl,
  ipfsUri,
  isLikelyArweaveId,
  isLikelyCid,
  isLikelyContentId,
  isSha256Hex,
  readAttachments,
} from "../src/events/index.js";
import { createMemoryStore } from "../src/store/index.js";
import type { IndexStore } from "../src/store/index.js";

const GATEWAY = { ipfs: "https://ipfs.example", arweave: "https://ar.example" };
const CID_V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const CID_V1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A gateway that serves a fixed body for each CID. */
function gatewayServing(bodies: Record<string, string | number>): FetchLike {
  return async (url: string) => {
    const cid = url.split("/ipfs/")[1] ?? "";
    const body = bodies[cid];

    if (body === undefined) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    if (typeof body === "number") {
      // A size, for exercising the verification ceiling without allocating real content.
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => new ArrayBuffer(body),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    };
  };
}

describe("attachment references", () => {
  it("accepts CIDv0 and CIDv1 shapes and rejects nonsense", () => {
    expect(isLikelyCid(CID_V0)).toBe(true);
    expect(isLikelyCid(CID_V1)).toBe(true);
    expect(isLikelyCid("not-a-cid")).toBe(false);
    expect(isLikelyCid("Qmtooshort")).toBe(false);
    expect(isLikelyCid(42)).toBe(false);
  });

  it("recognises a lowercase hex sha256 and nothing else", () => {
    expect(isSha256Hex(sha256("x"))).toBe(true);
    expect(isSha256Hex(sha256("x").toUpperCase())).toBe(false);
    expect(isSha256Hex("abc")).toBe(false);
  });

  it("reads well-formed references out of a payload", () => {
    const hash = sha256("certificate");
    const found = readAttachments({
      result: "pass",
      attachments: [{ cid: CID_V1, hash, name: "coa.pdf", type: "application/pdf", bytes: 11 }],
    });

    expect(found).toEqual([{ cid: CID_V1, hash, name: "coa.pdf", type: "application/pdf", bytes: 11 }]);
  });

  it("drops malformed entries rather than storing unverifiable half-records", () => {
    const hash = sha256("ok");
    const found = readAttachments({
      attachments: [{ cid: CID_V1, hash }, { cid: "garbage", hash }, { cid: CID_V0 }, { hash }, "not an object", null],
    });

    expect(found).toHaveLength(1);
    expect(found[0]!.cid).toBe(CID_V1);
  });

  it("returns nothing for payloads that declare no attachments", () => {
    expect(readAttachments({ result: "pass" })).toEqual([]);
    expect(readAttachments({ attachments: "nope" })).toEqual([]);
    expect(readAttachments(null)).toEqual([]);
  });

  it("builds gateway and canonical URIs", () => {
    expect(gatewayUrl(CID_V1, "https://g.example/")).toBe(`https://g.example/ipfs/${CID_V1}`);
    expect(ipfsUri(CID_V1)).toBe(`ipfs://${CID_V1}`);
  });
});

describe("verifyAttachment", () => {
  it("verifies a document whose bytes match the committed hash", async () => {
    const body = "conformity certificate";
    const result = await verifyAttachment(
      { cid: CID_V1, declaredHash: sha256(body) },
      GATEWAY,
      gatewayServing({ [CID_V1]: body }),
    );

    expect(result.state).toBe("verified");
    expect(result.observedHash).toBe(sha256(body));
    expect(result.bytes).toBe(body.length);
  });

  it("flags a document that was swapped after it was attested", async () => {
    const result = await verifyAttachment(
      { cid: CID_V1, declaredHash: sha256("the real certificate") },
      GATEWAY,
      gatewayServing({ [CID_V1]: "a different document entirely" }),
    );

    expect(result.state).toBe("mismatch");
    expect(result.note).toContain("does not match the hash committed on HCS");
    expect(result.observedHash).toBe(sha256("a different document entirely"));
  });

  it("reports an absent document as unreachable, not as a mismatch", async () => {
    const result = await verifyAttachment({ cid: CID_V1, declaredHash: sha256("x") }, GATEWAY, gatewayServing({}));

    // The distinction matters: nothing here is evidence the content is wrong.
    expect(result.state).toBe("unreachable");
    expect(result.note).toContain("404");
    expect(result.note).toContain("could not be read");
  });

  it("treats a thrown fetch as unreachable and says it proves nothing", async () => {
    const result = await verifyAttachment({ cid: CID_V1, declaredHash: sha256("x") }, GATEWAY, async () => {
      throw new Error("network down");
    });

    expect(result.state).toBe("unreachable");
    expect(result.note).toContain("network down");
    expect(result.note).toContain("not evidence the content is wrong");
  });

  it("refuses to hash a document over the verification ceiling", async () => {
    const result = await verifyAttachment(
      { cid: CID_V1, declaredHash: sha256("x") },
      GATEWAY,
      gatewayServing({ [CID_V1]: MAX_VERIFY_BYTES + 1 }),
    );

    expect(result.state).toBe("unreachable");
    expect(result.note).toContain("verification limit");
  });

  it("never throws, whatever the gateway does", async () => {
    for (const impl of [
      gatewayServing({}),
      (async () => {
        throw new Error("boom");
      }) as unknown as FetchLike,
    ]) {
      await expect(
        verifyAttachment({ cid: CID_V1, declaredHash: "a".repeat(64) }, GATEWAY, impl),
      ).resolves.toBeDefined();
    }
  });
});

describe("verifyPendingAttachments", () => {
  let store: IndexStore;

  beforeEach(async () => {
    store = await createMemoryStore();
    await store.upsertEvent({
      topicId: "0.0.6666666666",
      sequenceNumber: 1,
      consensusTimestamp: "1000.000000000",
      serial: 1,
      type: "product.inspected",
      hashValid: true,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("records references from a payload and leaves them pending", async () => {
    const hash = sha256("report");
    const found = await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: CID_V1, hash, name: "report.pdf" }],
    });

    expect(found).toHaveLength(1);
    const stored = await store.listAttachments(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.state).toBe("pending");
    expect(stored[0]!.declaredHash).toBe(hash);
    expect(stored[0]!.name).toBe("report.pdf");
  });

  it("verifies pending references and records the observed hash", async () => {
    const body = "test report";
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: CID_V1, hash: sha256(body) }],
    });

    const counts = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: body }));

    expect(counts).toEqual({ checked: 1, verified: 1, mismatch: 0, unreachable: 0 });
    const stored = await store.listAttachments(1);
    expect(stored[0]!.state).toBe("verified");
    expect(stored[0]!.observedHash).toBe(sha256(body));
    expect(stored[0]!.checkedAt).toBeTruthy();
  });

  it("does not re-fetch a document it has already verified", async () => {
    const body = "stable";
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: CID_V1, hash: sha256(body) }],
    });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: body }));

    // Content addressing means the bytes behind a CID cannot change, so a
    // second pass has nothing to do.
    const second = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: body }));
    expect(second.checked).toBe(0);
  });

  it("retries an unreachable document on the next pass", async () => {
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: CID_V1, hash: sha256("late") }],
    });

    const first = await verifyPendingAttachments(store, GATEWAY, gatewayServing({}));
    expect(first.unreachable).toBe(1);

    // A gateway that was down is not a permanent verdict.
    const second = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: "late" }));
    expect(second.verified).toBe(1);
    expect((await store.listAttachments(1))[0]!.state).toBe("verified");
  });

  it("keeps a mismatch as a permanent finding", async () => {
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: CID_V1, hash: sha256("original") }],
    });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: "swapped" }));

    const again = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: "swapped" }));
    expect(again.checked).toBe(0);
    expect((await store.listAttachments(1))[0]!.state).toBe("mismatch");
  });

  it("re-polling a topic does not discard a verdict already reached", async () => {
    const body = "certificate";
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: CID_V1, hash: sha256(body) }],
    });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: body }));

    // The poller re-declares the same reference on a later pass.
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: CID_V1, hash: sha256(body) }],
    });

    expect((await store.listAttachments(1))[0]!.state).toBe("verified");
  });

  it("counts a mix of outcomes independently", async () => {
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [
        { cid: CID_V1, hash: sha256("good") },
        { cid: CID_V0, hash: sha256("expected") },
      ],
    });

    const counts = await verifyPendingAttachments(
      store,
      GATEWAY,
      gatewayServing({ [CID_V1]: "good", [CID_V0]: "tampered" }),
    );

    expect(counts).toEqual({ checked: 2, verified: 1, mismatch: 1, unreachable: 0 });
  });

  it("reports document counts in stats", async () => {
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [
        { cid: CID_V1, hash: sha256("good") },
        { cid: CID_V0, hash: sha256("expected") },
      ],
    });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [CID_V1]: "good", [CID_V0]: "tampered" }));

    const stats = await store.stats();
    expect(stats.attachments).toBe(2);
    expect(stats.attachmentsVerified).toBe(1);
    expect(stats.attachmentsFailed).toBe(1);
  });
});

describe("Arweave-hosted documents", () => {
  const AR_ID = "cP3xMiEMRD9Wn9Q0vSHpbQ9GXXbQXn3KfvOaNT9Z-Ss";

  it("recognises an Arweave transaction id and rejects a CID as one", () => {
    expect(isLikelyArweaveId(AR_ID)).toBe(true);
    expect(isLikelyArweaveId(CID_V1)).toBe(false);
    expect(isLikelyArweaveId("too-short")).toBe(false);
    expect(isLikelyContentId(AR_ID, "arweave")).toBe(true);
    expect(isLikelyContentId(AR_ID, "ipfs")).toBe(false);
  });

  it("reads an Arweave reference out of a payload", () => {
    const hash = sha256("certificate");
    const found = readAttachments({
      attachments: [{ protocol: "arweave", cid: AR_ID, hash, name: "coa.pdf" }],
    });

    expect(found).toHaveLength(1);
    expect(found[0]!.protocol).toBe("arweave");
    expect(found[0]!.cid).toBe(AR_ID);
  });

  it("omits the protocol for IPFS, so existing events decode unchanged", () => {
    const hash = sha256("x");
    const found = readAttachments({ attachments: [{ cid: CID_V1, hash }] });
    expect(found[0]!.protocol).toBeUndefined();
  });

  it("drops a reference whose protocol it does not understand", () => {
    // Better to record nothing than to verify an id against the wrong network
    // and report a confident, meaningless verdict.
    const hash = sha256("x");
    expect(readAttachments({ attachments: [{ protocol: "filecoin", cid: CID_V1, hash }] })).toEqual([]);
  });

  it("builds the right gateway path for each network", () => {
    // Arweave serves the transaction id at the root; IPFS serves under /ipfs/.
    expect(gatewayUrl(AR_ID, "https://arweave.net", "arweave")).toBe(`https://arweave.net/${AR_ID}`);
    expect(gatewayUrl(CID_V1, "https://ipfs.io", "ipfs")).toBe(`https://ipfs.io/ipfs/${CID_V1}`);
    expect(contentUri(AR_ID, "arweave")).toBe(`ar://${AR_ID}`);
    expect(contentUri(CID_V1)).toBe(`ipfs://${CID_V1}`);
  });

  it("verifies an Arweave document through the Arweave gateway", async () => {
    const body = "permanent conformity certificate";
    const fetchImpl: FetchLike = async (url: string) => {
      // Asserts routing: an Arweave id must not be fetched from the IPFS gateway.
      expect(url).toBe(`https://ar.example/${AR_ID}`);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
      };
    };

    const result = await verifyAttachment(
      { cid: AR_ID, declaredHash: sha256(body), protocol: "arweave" },
      GATEWAY,
      fetchImpl,
    );
    expect(result.state).toBe("verified");
  });

  it("catches a swapped Arweave document exactly as it does an IPFS one", async () => {
    const result = await verifyAttachment(
      { cid: AR_ID, declaredHash: sha256("attested"), protocol: "arweave" },
      GATEWAY,
      async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => new TextEncoder().encode("replaced").buffer as ArrayBuffer,
      }),
    );

    expect(result.state).toBe("mismatch");
  });

  it("verifies a mixed passport, routing each document to its own network", async () => {
    const store = await createMemoryStore();
    try {
      await store.upsertEvent({
        topicId: "0.0.6666666666",
        sequenceNumber: 1,
        consensusTimestamp: "1000.000000000",
        serial: 1,
        type: "product.inspected",
        hashValid: true,
      });
      await recordAttachments(store, "0.0.6666666666", 1, {
        attachments: [
          { cid: CID_V1, hash: sha256("on ipfs") },
          { protocol: "arweave", cid: AR_ID, hash: sha256("on arweave") },
        ],
      });

      const seen: string[] = [];
      const counts = await verifyPendingAttachments(store, GATEWAY, async (url: string) => {
        seen.push(url);
        const body = url.includes("/ipfs/") ? "on ipfs" : "on arweave";
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
        };
      });

      expect(counts.verified).toBe(2);
      expect(seen).toContain(`https://ipfs.example/ipfs/${CID_V1}`);
      expect(seen).toContain(`https://ar.example/${AR_ID}`);
    } finally {
      await store.close();
    }
  });
});
