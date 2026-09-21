import { describe, expect, it } from "vitest";
import vectors from "../../../schemas/event-vectors.json";
import {
  MAX_EVENT_BYTES,
  assertNoEmbeddedContent,
  buildEvent,
  canonicalize,
  decodeBase64Event,
  decodeEvent,
  hashPayload,
  isCustomEventType,
  isKnownEventType,
  reassemble,
  type BuildEventInput,
  type MirrorTopicMessage,
} from "../src/events/index.js";

/** Base64-encodes a message body the way the mirror node returns it. */
function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("conformance vectors", () => {
  it.each(vectors.canonicalize)("canonicalize: $name", ({ value, canonical }) => {
    expect(canonicalize(value)).toBe(canonical);
  });

  it.each(vectors.payloadHash)("payload hash: $name", ({ payload, canonical, payloadHash }) => {
    expect(canonicalize(payload)).toBe(canonical);
    expect(hashPayload(payload)).toBe(payloadHash);
  });

  it.each(vectors.events)("event message: $name", ({ input, message, payloadHash, bytes }) => {
    const { ts, ...rest } = input as unknown as BuildEventInput & { ts: string };
    const built = buildEvent({ ...rest, ts: new Date(ts) });

    expect(built.message).toBe(message);
    expect(built.event.payloadHash).toBe(payloadHash);
    expect(Buffer.byteLength(built.message, "utf8")).toBe(bytes);
  });
});

describe("canonicalize", () => {
  it("drops undefined properties so absent and explicitly-undefined hash alike", () => {
    // JSON cannot represent undefined, so this cannot live in the vector file.
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(hashPayload({ a: 1, b: undefined })).toBe(hashPayload({ a: 1 }));
  });

  it("is order-independent for equal payloads", () => {
    expect(hashPayload({ x: 1, y: 2 })).toBe(hashPayload({ y: 2, x: 1 }));
  });

  it("distinguishes payloads that differ only in value", () => {
    expect(hashPayload({ result: "pass" })).not.toBe(hashPayload({ result: "fail" }));
  });
});

describe("buildEvent", () => {
  const base = {
    type: "product.shipped" as const,
    serial: 1,
    tokenId: "0.0.5005",
    actor: "0xabc",
    ts: new Date("2026-09-21T10:00:00.000Z"),
  };

  it("omits absent optional fields instead of emitting nulls", () => {
    const { message } = buildEvent({ ...base, payload: {} });
    expect(message).not.toContain('"ref"');
    expect(message).not.toContain('"prev"');
    expect(message).not.toContain('"sig"');
  });

  it("refuses a message over the HCS cap", () => {
    // Several individually-acceptable fields that together blow the byte budget,
    // so this exercises the size cap rather than the per-value content check.
    const payload = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`field${index}`, "x".repeat(400)]));
    expect(() => buildEvent({ ...base, payload })).toThrow(new RegExp(`over the ${MAX_EVENT_BYTES}-byte limit`));
  });

  it("refuses a data URI, however small", () => {
    expect(() => buildEvent({ ...base, payload: { image: "data:image/png;base64,iVBORw0KG" } })).toThrow(/data URI/);
  });

  it("refuses a long value in a blob-prone field", () => {
    expect(() => buildEvent({ ...base, payload: { certificate: "A".repeat(300) } })).toThrow(
      /too long to be a reference/,
    );
  });

  it("allows a URL and hash in a blob-prone field", () => {
    expect(() =>
      buildEvent({
        ...base,
        payload: {
          attachmentUrl: "https://example.com/cert.pdf",
          attachmentHash: "a".repeat(64),
        },
      }),
    ).not.toThrow();
  });

  it("allows ordinary long-ish prose that is not a blob field", () => {
    expect(() => assertNoEmbeddedContent({ note: "B".repeat(300) })).not.toThrow();
  });

  it("rejects a long value under any key, however it is named", () => {
    // Field-name heuristics leak, so there is a limit that ignores the name.
    expect(() => assertNoEmbeddedContent({ spec_sheet: "C".repeat(600) })).toThrow(/too long to be a reference/);
  });
});

describe("decodeEvent", () => {
  const valid = {
    v: 1,
    type: "product.inspected",
    serial: 1,
    tokenId: "0.0.5005",
    ts: "2026-09-21T10:00:00.000Z",
    actor: "0xabc",
    payloadHash: hashPayload({ result: "pass" }),
    payload: { result: "pass" },
  };

  it("decodes a well-formed event and confirms its hash", () => {
    const result = decodeEvent(JSON.stringify(valid));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hashValid).toBe(true);
    expect(result.isCustom).toBe(false);
    expect(result.event.type).toBe("product.inspected");
  });

  it("flags an event whose payload no longer matches its hash", () => {
    const tampered = { ...valid, payload: { result: "fail" } };
    const result = decodeEvent(JSON.stringify(tampered));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hashValid).toBe(false);
  });

  it("accepts a custom type and marks it as custom", () => {
    const custom = { ...valid, type: "custom.state_of_health" };
    const result = decodeEvent(JSON.stringify(custom));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isCustom).toBe(true);
  });

  it("keeps unknown top-level fields so a replay matches the log", () => {
    const extended = { ...valid, futureField: "kept" };
    const result = decodeEvent(JSON.stringify(extended));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.event as unknown as Record<string, unknown>).futureField).toBe("kept");
  });

  it("records malformed messages rather than dropping them", () => {
    const cases: Array<[string, string]> = [
      ["not json at all", "invalid-json"],
      ["[1,2,3]", "not-an-object"],
      [JSON.stringify({ ...valid, v: undefined }), "missing-required-field"],
      [JSON.stringify({ ...valid, v: 99 }), "unsupported-version"],
      [JSON.stringify({ ...valid, type: "nonsense" }), "bad-field-type"],
      [JSON.stringify({ ...valid, serial: 0 }), "bad-field-type"],
      [JSON.stringify({ ...valid, tokenId: "nope" }), "bad-field-type"],
      [JSON.stringify({ ...valid, payloadHash: "short" }), "bad-field-type"],
      [JSON.stringify({ ...valid, payload: [] }), "bad-field-type"],
    ];

    for (const [raw, reason] of cases) {
      const result = decodeEvent(raw);
      expect(result.ok, `expected ${raw.slice(0, 40)} to be malformed`).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe(reason);
      expect(result.rawHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("decodes the base64 form the mirror node returns", () => {
    const result = decodeBase64Event(b64(JSON.stringify(valid)));
    expect(result.ok).toBe(true);
  });

  it("never throws, whatever it is handed", () => {
    for (const raw of ["", "{", "null", "undefined", "𝕒𝕓", "0"]) {
      expect(() => decodeEvent(raw)).not.toThrow();
    }
  });
});

describe("event type registry", () => {
  it("accepts built-ins and well-formed custom types", () => {
    expect(isKnownEventType("product.shipped")).toBe(true);
    expect(isKnownEventType("custody.transferred")).toBe(true);
    expect(isCustomEventType("custom.state_of_health")).toBe(true);
  });

  it("rejects near-misses", () => {
    expect(isKnownEventType("product.exploded")).toBe(false);
    expect(isKnownEventType("custom.")).toBe(false);
    expect(isKnownEventType("custom.NotLowercase")).toBe(false);
    expect(isKnownEventType("shipped")).toBe(false);
  });
});

describe("reassemble", () => {
  const plain = (sequence: number, body: string): MirrorTopicMessage => ({
    consensus_timestamp: `1758448800.00000000${sequence}`,
    message: b64(body),
    sequence_number: sequence,
    topic_id: "0.0.6006",
  });

  it("passes single-part messages straight through", () => {
    const { complete, incompleteKeys } = reassemble([plain(1, "hello"), plain(2, "world")]);
    expect(complete.map(m => m.raw)).toEqual(["hello", "world"]);
    expect(complete.every(m => m.chunkCount === 1)).toBe(true);
    expect(incompleteKeys).toEqual([]);
  });

  it("joins a chunked message in chunk order, not arrival order", () => {
    const id = { account_id: "0.0.1234", transaction_valid_start: "1758448800.000000000", nonce: 0 };
    const { complete } = reassemble([
      { ...plain(2, "world"), chunk_info: { initial_transaction_id: id, number: 2, total: 2 } },
      { ...plain(1, "hello "), chunk_info: { initial_transaction_id: id, number: 1, total: 2 } },
    ]);

    expect(complete).toHaveLength(1);
    expect(complete[0]!.raw).toBe("hello world");
    expect(complete[0]!.chunkCount).toBe(2);
    // The message completes at its LAST chunk, which is sequence 2 here, not at
    // whichever part the mirror node happened to return first.
    expect(complete[0]!.sequenceNumber).toBe(2);
  });

  it("reports an incomplete chunk set instead of decoding a truncated message", () => {
    const id = { account_id: "0.0.1234", transaction_valid_start: "1758448800.000000000", nonce: 0 };
    const { complete, incompleteKeys } = reassemble([
      { ...plain(1, "half "), chunk_info: { initial_transaction_id: id, number: 1, total: 2 } },
    ]);

    expect(complete).toEqual([]);
    expect(incompleteKeys).toHaveLength(1);
  });

  it("keeps two interleaved chunk sets apart", () => {
    const a = { account_id: "0.0.1", transaction_valid_start: "1.0", nonce: 0 };
    const b = { account_id: "0.0.2", transaction_valid_start: "2.0", nonce: 0 };
    const { complete } = reassemble([
      { ...plain(1, "A1"), chunk_info: { initial_transaction_id: a, number: 1, total: 2 } },
      { ...plain(2, "B1"), chunk_info: { initial_transaction_id: b, number: 1, total: 2 } },
      { ...plain(3, "B2"), chunk_info: { initial_transaction_id: b, number: 2, total: 2 } },
      { ...plain(4, "A2"), chunk_info: { initial_transaction_id: a, number: 2, total: 2 } },
    ]);

    expect(complete.map(m => m.raw).sort()).toEqual(["A1A2", "B1B2"]);
  });

  it("treats total <= 1 as a plain message", () => {
    const { complete } = reassemble([
      { ...plain(1, "solo"), chunk_info: { initial_transaction_id: "x", number: 1, total: 1 } },
    ]);
    expect(complete[0]!.raw).toBe("solo");
  });
});
