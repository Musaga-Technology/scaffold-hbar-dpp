import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_GATEWAYS,
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
import { buildCar } from "../src/content/ipfs.js";
import { createMemoryStore } from "../src/store/index.js";
import type { IndexStore } from "../src/store/index.js";

const GATEWAY = { ipfs: ["https://ipfs.example"], arweave: "https://ar.example" };
const CID_V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const CID_V1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const bytesOf = (text: string) => new TextEncoder().encode(text);

/** A document as it would be pinned: its real CID, its CAR, and its sha256. */
async function pinned(text: string): Promise<{ cid: string; car: Uint8Array; hash: string }> {
  const { cid, car } = await buildCar(bytesOf(text));
  return { cid, car, hash: sha256(text) };
}

type Served = Uint8Array | number;

function reply(body: Served | undefined) {
  if (body === undefined) {
    return { ok: false, status: 404, statusText: "Not Found", arrayBuffer: async () => new ArrayBuffer(0) };
  }
  // A number is a size, for exercising the ceiling without allocating real content.
  const buffer = typeof body === "number" ? new ArrayBuffer(body) : (body.slice().buffer as ArrayBuffer);
  return { ok: true, status: 200, statusText: "OK", arrayBuffer: async () => buffer };
}

/** A trustless gateway that serves a fixed CAR for each CID. */
function gatewayServing(cars: Record<string, Served>): FetchLike {
  return async (url: string) => reply(cars[url.split("/ipfs/")[1]?.split("?")[0] ?? ""]);
}

/** Several gateways at once, keyed by host, for fallback tests. */
function gatewaysServing(byHost: Record<string, Record<string, Served>>): FetchLike {
  return async (url: string) => {
    const parsed = new URL(url);
    return reply(byHost[parsed.host]?.[parsed.pathname.replace("/ipfs/", "")]);
  };
}

/** Flips one byte of a CAR's payload, the way a dishonest gateway would. */
function tamper(car: Uint8Array): Uint8Array {
  const copy = car.slice();
  copy[copy.length - 3]! ^= 0xff;
  return copy;
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
  it("verifies a document rebuilt from blocks checked against its CID", async () => {
    const doc = await pinned("conformity certificate");
    const result = await verifyAttachment(
      { cid: doc.cid, declaredHash: doc.hash },
      GATEWAY,
      gatewayServing({ [doc.cid]: doc.car }),
    );

    expect(result.state).toBe("verified");
    expect(result.observedHash).toBe(doc.hash);
    expect(result.bytes).toBe("conformity certificate".length);
    expect(result.note).toContain("checked against the CID");
    expect(result.note).toContain("ipfs.example");
  });

  it("asks the gateway for a CAR of exactly the document, not for the file", async () => {
    const doc = await pinned("report");
    const seen: { url: string; accept?: string }[] = [];

    await verifyAttachment({ cid: doc.cid, declaredHash: doc.hash }, GATEWAY, async (url, init) => {
      seen.push({ url, accept: init?.headers?.accept });
      return reply(doc.car);
    });

    expect(seen).toEqual([
      {
        url: `https://ipfs.example/ipfs/${doc.cid}?format=car&dag-scope=entity`,
        accept: "application/vnd.ipld.car",
      },
    ]);
  });

  it("verifies a document spanning many blocks", async () => {
    // Over the 1 MiB chunk size, so the CID is a DAG root rather than a hash of
    // the file — the case where the CID and the sha256 genuinely differ.
    const text = "battery test report ".repeat(120_000);
    const doc = await pinned(text);
    expect(doc.cid.startsWith("bafy")).toBe(true);

    const result = await verifyAttachment(
      { cid: doc.cid, declaredHash: doc.hash },
      GATEWAY,
      gatewayServing({ [doc.cid]: doc.car }),
    );

    expect(result.state).toBe("verified");
    expect(result.bytes).toBe(text.length);
  });

  it("flags an attestation whose hash does not match the document its CID names", async () => {
    // The issuer committed the CID of one document and the sha256 of another.
    // Content behind a CID cannot change, so this is the real failure mode.
    const pointedAt = await pinned("a different document entirely");
    const result = await verifyAttachment(
      { cid: pointedAt.cid, declaredHash: sha256("the real certificate") },
      GATEWAY,
      gatewayServing({ [pointedAt.cid]: pointedAt.car }),
    );

    expect(result.state).toBe("mismatch");
    expect(result.note).toContain("not the one whose hash was committed on HCS");
    expect(result.note).not.toMatch(/replaced|swapped/);
    expect(result.observedHash).toBe(pointedAt.hash);
  });

  it("catches a gateway that serves altered content, and does not blame the passport", async () => {
    const doc = await pinned("inspection record");
    const result = await verifyAttachment(
      { cid: doc.cid, declaredHash: doc.hash },
      GATEWAY,
      gatewayServing({ [doc.cid]: tamper(doc.car) }),
    );

    // A lying gateway is caught at the block level. It cannot manufacture a
    // mismatch, because nothing it serves is used until it checks out.
    expect(result.state).toBe("unreachable");
    expect(result.note).toContain("does not hash to its own CID");
    expect(result.note).toContain("not evidence the content is wrong");
  });

  it("falls back to the next gateway when one lies", async () => {
    const doc = await pinned("declaration of conformity");
    const result = await verifyAttachment(
      { cid: doc.cid, declaredHash: doc.hash },
      { ipfs: ["https://liar.example", "https://honest.example"], arweave: GATEWAY.arweave },
      gatewaysServing({
        "liar.example": { [doc.cid]: tamper(doc.car) },
        "honest.example": { [doc.cid]: doc.car },
      }),
    );

    expect(result.state).toBe("verified");
    expect(result.note).toContain("honest.example");
  });

  it("rejects a CAR for some other CID, however valid its blocks", async () => {
    const asked = await pinned("the certificate");
    const other = await pinned("something else");
    const result = await verifyAttachment(
      { cid: asked.cid, declaredHash: asked.hash },
      GATEWAY,
      gatewayServing({ [asked.cid]: other.car }),
    );

    expect(result.state).toBe("unreachable");
    expect(result.note).toContain(`does not contain ${asked.cid}`);
  });

  it("does not accept a plain file from a gateway that ignores the CAR request", async () => {
    // A gateway that serves raw bytes has proved nothing about the CID. Hashing
    // them anyway would bring back exactly the trust this design removes.
    const doc = await pinned("plain bytes");
    const result = await verifyAttachment(
      { cid: doc.cid, declaredHash: doc.hash },
      GATEWAY,
      gatewayServing({ [doc.cid]: bytesOf("plain bytes") }),
    );

    expect(result.state).toBe("unreachable");
    expect(result.note).toContain("not a readable CAR");
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

  it("refuses to read a response over the verification ceiling", async () => {
    const result = await verifyAttachment(
      { cid: CID_V1, declaredHash: sha256("x") },
      GATEWAY,
      gatewayServing({ [CID_V1]: MAX_VERIFY_BYTES * 2 }),
    );

    expect(result.state).toBe("unreachable");
    expect(result.note).toContain("verification limit");
  });

  it("defaults to two independent trustless gateways", () => {
    expect(DEFAULT_GATEWAYS.ipfs).toEqual(["https://trustless-gateway.link", "https://gateway.pinata.cloud"]);
  });

  it("never throws, whatever the gateway does", async () => {
    for (const impl of [
      gatewayServing({}),
      gatewayServing({ [CID_V1]: bytesOf("garbage") }),
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
    const doc = await pinned("test report");
    await recordAttachments(store, "0.0.6666666666", 1, { attachments: [{ cid: doc.cid, hash: doc.hash }] });

    const counts = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [doc.cid]: doc.car }));

    expect(counts).toEqual({ checked: 1, verified: 1, mismatch: 0, unreachable: 0 });
    const stored = await store.listAttachments(1);
    expect(stored[0]!.state).toBe("verified");
    expect(stored[0]!.observedHash).toBe(doc.hash);
    expect(stored[0]!.checkedAt).toBeTruthy();
  });

  it("does not re-fetch a document it has already verified", async () => {
    const doc = await pinned("stable");
    await recordAttachments(store, "0.0.6666666666", 1, { attachments: [{ cid: doc.cid, hash: doc.hash }] });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [doc.cid]: doc.car }));

    // Content addressing means the bytes behind a CID cannot change, so a
    // second pass has nothing to do.
    const second = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [doc.cid]: doc.car }));
    expect(second.checked).toBe(0);
  });

  it("retries an unreachable document on the next pass", async () => {
    const doc = await pinned("late");
    await recordAttachments(store, "0.0.6666666666", 1, { attachments: [{ cid: doc.cid, hash: doc.hash }] });

    const first = await verifyPendingAttachments(store, GATEWAY, gatewayServing({}));
    expect(first.unreachable).toBe(1);

    // A gateway that was down is not a permanent verdict.
    const second = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [doc.cid]: doc.car }));
    expect(second.verified).toBe(1);
    expect((await store.listAttachments(1))[0]!.state).toBe("verified");
  });

  it("retries after a gateway served altered blocks", async () => {
    const doc = await pinned("contested");
    await recordAttachments(store, "0.0.6666666666", 1, { attachments: [{ cid: doc.cid, hash: doc.hash }] });

    const first = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [doc.cid]: tamper(doc.car) }));
    expect(first.unreachable).toBe(1);

    const second = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [doc.cid]: doc.car }));
    expect(second.verified).toBe(1);
  });

  it("keeps a mismatch as a permanent finding", async () => {
    const pointedAt = await pinned("not what was attested");
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [{ cid: pointedAt.cid, hash: sha256("original") }],
    });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [pointedAt.cid]: pointedAt.car }));

    const again = await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [pointedAt.cid]: pointedAt.car }));
    expect(again.checked).toBe(0);
    expect((await store.listAttachments(1))[0]!.state).toBe("mismatch");
  });

  it("re-polling a topic does not discard a verdict already reached", async () => {
    const doc = await pinned("certificate");
    await recordAttachments(store, "0.0.6666666666", 1, { attachments: [{ cid: doc.cid, hash: doc.hash }] });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [doc.cid]: doc.car }));

    // The poller re-declares the same reference on a later pass.
    await recordAttachments(store, "0.0.6666666666", 1, { attachments: [{ cid: doc.cid, hash: doc.hash }] });

    expect((await store.listAttachments(1))[0]!.state).toBe("verified");
  });

  it("counts a mix of outcomes independently", async () => {
    const good = await pinned("good");
    const bad = await pinned("tampered");
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [
        { cid: good.cid, hash: good.hash },
        { cid: bad.cid, hash: sha256("expected") },
      ],
    });

    const counts = await verifyPendingAttachments(
      store,
      GATEWAY,
      gatewayServing({ [good.cid]: good.car, [bad.cid]: bad.car }),
    );

    expect(counts).toEqual({ checked: 2, verified: 1, mismatch: 1, unreachable: 0 });
  });

  it("reports document counts in stats", async () => {
    const good = await pinned("good");
    const bad = await pinned("tampered");
    await recordAttachments(store, "0.0.6666666666", 1, {
      attachments: [
        { cid: good.cid, hash: good.hash },
        { cid: bad.cid, hash: sha256("expected") },
      ],
    });
    await verifyPendingAttachments(store, GATEWAY, gatewayServing({ [good.cid]: good.car, [bad.cid]: bad.car }));

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

  it("flags an Arweave document that does not match its attestation, and says the gateway was trusted", async () => {
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
    // Arweave ids are not content hashes, so this path cannot rule out a lying
    // gateway — and the note must not claim more than it checked.
    expect(result.note).toContain("not content hashes");
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
      const onIpfs = await pinned("on ipfs");
      await recordAttachments(store, "0.0.6666666666", 1, {
        attachments: [
          { cid: onIpfs.cid, hash: onIpfs.hash },
          { protocol: "arweave", cid: AR_ID, hash: sha256("on arweave") },
        ],
      });

      const seen: string[] = [];
      const counts = await verifyPendingAttachments(store, GATEWAY, async (url: string) => {
        seen.push(url);
        return reply(url.includes("/ipfs/") ? onIpfs.car : bytesOf("on arweave"));
      });

      expect(counts.verified).toBe(2);
      expect(seen).toContain(`https://ipfs.example/ipfs/${onIpfs.cid}?format=car&dag-scope=entity`);
      expect(seen).toContain(`https://ar.example/${AR_ID}`);
    } finally {
      await store.close();
    }
  });
});
