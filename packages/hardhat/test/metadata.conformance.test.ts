import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";

import { buildHip412Metadata, checkMetadataPointer, METADATA_POINTER_MAX_BYTES } from "../scripts/lib/metadata";

/**
 * Conformance of this workspace's HIP-412 builder with the reference one.
 *
 * `packages/indexer/src/events/metadata.ts` is the reference. This workspace
 * cannot import it — CommonJS under ts-node versus ESM — so it keeps a copy,
 * and a copy of a document format is a drift hazard.
 *
 * It matters concretely: a passport minted by `yarn passport:bootstrap` and one
 * minted from the issuer page must look identical to HashScan and to wallets.
 * If the two builders diverge, that stops being true and nothing else would
 * notice.
 */
describe("HIP-412 metadata conformance", function () {
  const REFERENCE = path.join(__dirname, "..", "..", "indexer", "src", "events", "metadata.ts");

  const input = {
    category: "battery",
    topicId: "0.0.6666666666",
    productHash: "a".repeat(64),
    fields: { name: "PowerCell 72 kWh EV Pack", manufacturer: "Northwind Cells", ratedCapacityKwh: 72 },
  };

  it("produces the documented HIP-412 shape", function () {
    const metadata = buildHip412Metadata(input);

    expect(metadata.format).to.equal("HIP412@2.0.0");
    expect(metadata.type).to.equal("object");
    expect(metadata.name).to.equal("PowerCell 72 kWh EV Pack");
    expect(metadata.properties.category).to.equal("battery");
    expect(metadata.properties.topicId).to.equal("0.0.6666666666");
    expect(metadata.properties.ratedCapacityKwh).to.equal(72);
  });

  it("carries no serial, because the metadata is an argument to the mint that assigns it", function () {
    const metadata = buildHip412Metadata(input);
    expect(JSON.stringify(metadata)).to.not.contain("serial");
  });

  it("falls back to a topic-derived name when the fields carry none", function () {
    const metadata = buildHip412Metadata({ ...input, fields: {} });
    expect(metadata.name).to.equal("Passport 0.0.6666666666");
  });

  it("omits the image key entirely when there is no image", function () {
    expect("image" in buildHip412Metadata(input)).to.equal(false);
    expect(buildHip412Metadata({ ...input, image: "ipfs://bafy" }).image).to.equal("ipfs://bafy");
  });

  it("matches the reference implementation's description text verbatim", function () {
    // Comparing the rendered string against the reference source is crude but
    // catches the realistic failure: someone edits the wording in one file.
    const reference = fs.readFileSync(REFERENCE, "utf8");
    for (const fragment of [
      'Digital Product Passport${manufacturer ? ` for a product by ${manufacturer}` : ""}. ',
      "Lifecycle events are recorded on Hedera Consensus Service topic ${input.topicId} and reconciled ",
      "against this token's on-chain custody history. Referenced documents are content-addressed and ",
      "re-verified against the hashes committed on HCS.",
    ]) {
      expect(reference, `reference metadata.ts no longer contains: ${fragment}`).to.contain(fragment);
    }
  });

  it("agrees with the reference on the registry's pointer limit", function () {
    const reference = fs.readFileSync(REFERENCE, "utf8");
    const declared = reference.match(/METADATA_POINTER_MAX_BYTES\s*=\s*(\d+)/)?.[1];

    expect(declared, "reference does not declare METADATA_POINTER_MAX_BYTES").to.be.a("string");
    expect(Number(declared)).to.equal(METADATA_POINTER_MAX_BYTES);
  });

  it("matches the limit the contract actually enforces", async function () {
    const { ethers } = await import("hardhat");
    const [owner] = await ethers.getSigners();
    const registry = await ethers.getContractFactory("PassportRegistry");
    // Zero address for HTS selects the real 0x167; nothing here calls it.
    const contract = await registry.deploy(owner.address, ethers.ZeroAddress);
    await contract.waitForDeployment();

    // The whole point of the constant is to predict this revert before spending gas.
    expect(Number(await contract.METADATA_MAX_BYTES())).to.equal(METADATA_POINTER_MAX_BYTES);
  });

  it("accepts an ipfs pointer and rejects an over-long URL", function () {
    expect(checkMetadataPointer("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").fits).to.equal(
      true,
    );
    expect(checkMetadataPointer(`https://example.com/${"x".repeat(120)}`).fits).to.equal(false);
  });
});
