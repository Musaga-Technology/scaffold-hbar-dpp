import { createHash } from "node:crypto";
import { CarWriter } from "@ipld/car";
import { importer } from "ipfs-unixfs-importer";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";

import { CarVerificationError, buildCar, carUrl, computeCid, parseCid, readVerifiedCar } from "../src/content/ipfs.js";

const bytesOf = (text: string) => new TextEncoder().encode(text);

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return new Uint8Array(Buffer.concat(parts));
}

async function failure(car: Uint8Array, cid: string): Promise<CarVerificationError> {
  try {
    await readVerifiedCar(car, cid);
  } catch (error) {
    if (error instanceof CarVerificationError) return error;
    throw error;
  }
  throw new Error("expected readVerifiedCar to reject");
}

describe("computeCid", () => {
  it("gives a small document a raw CID that is its sha256", async () => {
    // Under the chunk size, the CID and the digest committed on HCS are the
    // same hash in two encodings.
    const bytes = bytesOf("hello world");
    const expected = CID.createV1(raw.code, await sha256.digest(bytes)).toString();

    expect(await computeCid(bytes)).toBe(expected);
    // Pinned against a value computed independently by other IPFS tooling.
    expect(expected).toBe("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
  });

  it("is deterministic", async () => {
    const bytes = bytesOf("declaration of conformity");
    expect(await computeCid(bytes)).toBe(await computeCid(bytes.slice()));
  });

  it("agrees with the CAR it would build", async () => {
    const bytes = new Uint8Array(2_500_000).map((_, i) => i % 256);
    const { cid } = await buildCar(bytes);
    expect(await computeCid(bytes)).toBe(cid);
  });

  // Computed independently with Kubo 0.43.1: `ipfs add --only-hash --cid-version=1`,
  // which is what Pinata documents as its default. If these drift, the upload
  // route would start refusing every document Pinata pins — so they are pinned
  // here, at each chunk boundary that changes the shape of the DAG.
  const pattern = (size: number) => Uint8Array.from({ length: size }, (_, i) => (i * 31) % 251);
  it.each([
    [11, "bafkreiagu34xh7y7aah24tznwigis52grqegahk2aly3kz3uzuubft7uji"],
    [262_144, "bafkreihcplssjx4a7ixm3txfegx65okzxd5iwk4yanaxly44vbuzqoljvy"],
    [262_145, "bafybeibfhcwpykfpnnswt4qsfbuhlgptzjba53tqe5gol7yjlscqgmwks4"],
    [3 * 1024 * 1024 + 17, "bafybeibrbx4qasqwm7yjmnxe6yjs2yh2cm4xyoaqykkcbtksfb52673yde"],
  ])("matches Kubo for a %i-byte document", async (size, expected) => {
    expect(await computeCid(pattern(size))).toBe(expected);
  });
});

describe("readVerifiedCar", () => {
  it("round-trips a single-block document", async () => {
    const bytes = bytesOf("inspection record");
    const { cid, car } = await buildCar(bytes);
    expect(await readVerifiedCar(car, cid)).toEqual(bytes);
  });

  it("round-trips a document spanning many blocks", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 17).map((_, i) => (i * 31) % 251);
    const { cid, car } = await buildCar(bytes);
    expect(cid.startsWith("bafy")).toBe(true);
    // Buffer#equals rather than toEqual: a deep diff of 3 MB takes seconds.
    expect(Buffer.from(await readVerifiedCar(car, cid)).equals(Buffer.from(bytes))).toBe(true);
  });

  it("accepts a CIDv0 reference to the same content", async () => {
    // Older tooling hands out Qm… CIDs. The blocks are the same; only the
    // encoding of the address differs.
    const blocks: { cid: CID; bytes: Uint8Array }[] = [];
    const store = {
      put: async (cid: CID, bytes: Uint8Array) => {
        blocks.push({ cid, bytes });
        return cid;
      },
    };
    let root: CID | undefined;
    for await (const entry of importer([{ content: bytesOf("legacy certificate") }], store as never, {
      profile: "unixfs-v0-2015",
    })) {
      root = entry.cid;
    }
    expect(root!.toString().startsWith("Qm")).toBe(true);

    const { writer, out } = CarWriter.create([root!]);
    const car = collect(out);
    for (const block of blocks) await writer.put(block);
    await writer.close();

    expect(new TextDecoder().decode(await readVerifiedCar(await car, root!.toString()))).toBe("legacy certificate");
  });

  it("rejects a block whose bytes do not hash to its CID", async () => {
    const { cid, car } = await buildCar(bytesOf("certificate"));
    const altered = car.slice();
    altered[altered.length - 2]! ^= 0x01;

    expect((await failure(altered, cid)).reason).toBe("tampered-block");
  });

  it("rejects a CAR for a different document", async () => {
    const asked = await buildCar(bytesOf("the certificate"));
    const served = await buildCar(bytesOf("another certificate"));

    expect((await failure(served.car, asked.cid)).reason).toBe("wrong-root");
  });

  it("rejects a CAR that is missing blocks", async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 5).map((_, i) => i % 97);
    const { cid, car } = await buildCar(bytes);

    // Keep only the root: the file's leaves are gone.
    const { writer, out } = CarWriter.create([CID.parse(cid)]);
    const truncated = collect(out);
    const { CarBlockIterator } = await import("@ipld/car");
    for await (const block of await CarBlockIterator.fromBytes(car)) {
      if (block.cid.toString() === cid) await writer.put(block);
    }
    await writer.close();

    expect((await failure(await truncated, cid)).reason).toBe("incomplete");
  });

  it("rejects a directory, because an attachment names one document", async () => {
    const blocks: { cid: CID; bytes: Uint8Array }[] = [];
    const store = {
      put: async (cid: CID, bytes: Uint8Array) => {
        blocks.push({ cid, bytes });
        return cid;
      },
    };
    let root: CID | undefined;
    for await (const entry of importer([{ path: "a.txt", content: bytesOf("a") }], store as never, {
      wrapWithDirectory: true,
    })) {
      root = entry.cid;
    }

    const { writer, out } = CarWriter.create([root!]);
    const car = collect(out);
    for (const block of blocks) await writer.put(block);
    await writer.close();

    expect((await failure(await car, root!.toString())).reason).toBe("not-a-file");
  });

  it("refuses to vouch for a hash function it cannot check", async () => {
    // A blake2b-256 CID. Accepting it unchecked would put an unverified
    // document behind a verified badge.
    const bytes = bytesOf("x");
    const digest = createHash("sha256").update(bytes).digest();
    const multihash = Uint8Array.from([0xa0, 0xe4, 0x02, 0x20, ...digest]);
    const cid = CID.createV1(raw.code, { code: 0xb220, size: 32, digest, bytes: multihash } as never);

    const { writer, out } = CarWriter.create([cid]);
    const car = collect(out);
    await writer.put({ cid, bytes });
    await writer.close();

    expect((await failure(await car, cid.toString())).reason).toBe("unsupported-hash");
  });

  it("rejects bytes that are not a CAR at all", async () => {
    const { cid } = await buildCar(bytesOf("real"));
    expect((await failure(bytesOf("<html>gateway error page</html>"), cid)).reason).toBe("malformed");
  });

  it("rejects a malformed CID before looking at anything", async () => {
    const { car } = await buildCar(bytesOf("real"));
    expect((await failure(car, "not-a-cid")).reason).toBe("malformed");
  });
});

describe("helpers", () => {
  it("builds the trustless-gateway URL for exactly one document", () => {
    expect(carUrl("bafkreiabc", "https://g.example/")).toBe(
      "https://g.example/ipfs/bafkreiabc?format=car&dag-scope=entity",
    );
  });

  it("parses CIDs without throwing", () => {
    expect(parseCid("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e")).not.toBeNull();
    expect(parseCid("nope")).toBeNull();
  });
});
