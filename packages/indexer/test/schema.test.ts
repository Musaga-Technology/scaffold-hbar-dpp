import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import eventSchema from "../../../schemas/passport-event.schema.json";
import vectors from "../../../schemas/event-vectors.json";
import { buildEvent, type BuildEventInput } from "../src/events/index.js";

/**
 * The published schema is the contract every reader of a topic relies on, and
 * until this file existed nothing tested it.
 *
 * That gap hid a real defect: the app compiled this schema with Ajv's default
 * export, which speaks draft-07, while the schema declares draft 2020-12.
 * Compilation threw, so *every* schema check failed with a 500 — and it went
 * unnoticed because every test payload was rejected earlier in the chain, by
 * the request validator or the size cap, and never reached the schema at all.
 */
function compile() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(eventSchema);
}

describe("passport-event.schema.json", () => {
  it("compiles under the dialect it declares", () => {
    expect(eventSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(() => compile()).not.toThrow();
  });

  it("accepts every event in the conformance vectors", () => {
    const validate = compile();

    for (const vector of vectors.events) {
      const { ts, ...rest } = vector.input as unknown as BuildEventInput & { ts: string };
      const { event } = buildEvent({ ...rest, ts: new Date(ts) });

      expect(validate(event), `${vector.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it("accepts an event carrying content-addressed attachments", () => {
    const validate = compile();
    const { event } = buildEvent({
      type: "product.inspected",
      serial: 1,
      tokenId: "0.0.5555555555",
      actor: "0.0.1111111111",
      payload: {
        result: "pass",
        attachments: [
          {
            cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            hash: "a".repeat(64),
            name: "certificate.pdf",
          },
        ],
      },
      ts: new Date("2026-09-21T10:00:00.000Z"),
    });

    expect(validate(event), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects what it is supposed to reject", () => {
    const validate = compile();
    const base = {
      v: 1,
      type: "product.shipped",
      serial: 1,
      tokenId: "0.0.5555555555",
      ts: "2026-09-21T10:00:00.000Z",
      actor: "0.0.1111111111",
      payloadHash: "a".repeat(64),
      payload: {},
    };

    const cases: Array<[string, unknown]> = [
      ["wrong schema version", { ...base, v: 2 }],
      ["unknown event type", { ...base, type: "product.exploded" }],
      ["uppercase custom type", { ...base, type: "custom.NotLowercase" }],
      ["serial below one", { ...base, serial: 0 }],
      ["malformed token id", { ...base, tokenId: "5005" }],
      ["short payload hash", { ...base, payloadHash: "abc" }],
      ["uppercase payload hash", { ...base, payloadHash: "A".repeat(64) }],
      ["payload as array", { ...base, payload: [] }],
      ["missing actor", { ...base, actor: undefined }],
      [
        "payload with too many properties",
        { ...base, payload: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, i])) },
      ],
    ];

    for (const [name, candidate] of cases) {
      expect(validate(candidate), `expected the schema to reject: ${name}`).toBe(false);
    }
  });
});
