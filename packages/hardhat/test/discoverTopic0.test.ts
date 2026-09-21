import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

/**
 * Guards the event-signature hash the indexer uses to find product topics.
 *
 * `packages/indexer/src/discover.ts` filters the registry's mirror-node logs by
 * topic 0. The indexer has no EVM codec of its own, so that hash is a hard-coded
 * constant. If someone changes the `ProductRegistered` signature, discovery
 * would quietly find nothing — topics would stop being indexed and passports
 * would silently stop updating, with no error anywhere.
 *
 * This test derives the hash from the compiled ABI and compares it to the
 * constant, so that change breaks the build instead.
 */
describe("indexer topic discovery constant", function () {
  const DISCOVER_PATH = path.join(__dirname, "..", "..", "indexer", "src", "discover.ts");

  it("matches keccak256 of the compiled ProductRegistered signature", async function () {
    const registry = await ethers.getContractFactory("PassportRegistry");
    const fragment = registry.interface.getEvent("ProductRegistered");
    expect(fragment, "PassportRegistry must still emit ProductRegistered").to.not.equal(null);

    const derived = ethers.id(fragment!.format("sighash"));

    const source = fs.readFileSync(DISCOVER_PATH, "utf8");
    const declared = source.match(/PRODUCT_REGISTERED_TOPIC0\s*=\s*"(0x[0-9a-fA-F]{64})"/)?.[1];

    expect(declared, `Could not find PRODUCT_REGISTERED_TOPIC0 in ${DISCOVER_PATH}`).to.be.a("string");
    expect(declared!.toLowerCase()).to.equal(
      derived.toLowerCase(),
      "PassportRegistry's ProductRegistered signature changed. Update PRODUCT_REGISTERED_TOPIC0 in " +
        "packages/indexer/src/discover.ts, or topic discovery will silently find nothing.",
    );
  });

  it("still declares topicId as a non-indexed string the indexer can decode", async function () {
    const registry = await ethers.getContractFactory("PassportRegistry");
    const fragment = registry.interface.getEvent("ProductRegistered")!;
    const topicIdInput = fragment.inputs.find(input => input.name === "topicId");

    expect(topicIdInput?.type).to.equal("string");
    // Indexed strings are stored as a hash, which would make the topic id
    // unrecoverable from the log.
    expect(topicIdInput?.indexed).to.equal(false);
  });
});
