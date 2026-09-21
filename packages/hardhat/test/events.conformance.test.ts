import { expect } from "chai";

import vectors from "../../../schemas/event-vectors.json";
import { buildEvent, canonicalize, sha256Hex, type BuildEventInput } from "../scripts/lib/events";

/**
 * Conformance of the hardhat workspace's event implementation.
 *
 * The reference implementation lives in `packages/indexer/src/events/`. The
 * bootstrap script cannot import it directly — this workspace runs as CommonJS
 * under ts-node while the indexer is ESM — so it keeps a small copy of
 * canonicalisation, hashing and event construction.
 *
 * Two implementations of a hash function is a drift hazard, so both are pinned
 * to the same vectors in `schemas/event-vectors.json`. If they ever diverge,
 * this test fails instead of the bootstrap quietly writing events whose payload
 * hashes the indexer cannot verify.
 */
describe("event conformance with schemas/event-vectors.json", function () {
  it("agrees on the schema version the vectors were generated for", function () {
    expect(vectors.schemaVersion).to.equal(1);
  });

  describe("canonicalize", function () {
    for (const vector of vectors.canonicalize) {
      it(vector.name, function () {
        expect(canonicalize(vector.value)).to.equal(vector.canonical);
      });
    }
  });

  describe("payload hashing", function () {
    for (const vector of vectors.payloadHash) {
      it(vector.name, function () {
        expect(canonicalize(vector.payload)).to.equal(vector.canonical);
        expect(sha256Hex(canonicalize(vector.payload))).to.equal(vector.payloadHash);
      });
    }
  });

  describe("event messages", function () {
    for (const vector of vectors.events) {
      it(vector.name, function () {
        const { ts, ...rest } = vector.input as unknown as BuildEventInput & { ts: string };
        const { event, message } = buildEvent({ ...rest, ts: new Date(ts) });

        expect(message).to.equal(vector.message);
        expect(event.payloadHash).to.equal(vector.payloadHash);
        expect(Buffer.byteLength(message, "utf8")).to.equal(vector.bytes);
      });
    }
  });
});
