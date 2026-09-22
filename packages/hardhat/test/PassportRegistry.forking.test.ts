import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Opt-in tests against the real HTS system contract.
 *
 * `yarn hardhat:test` runs everything against `MockHTS`, which is fast, free and
 * deterministic — and which we wrote. A mock agreeing with the contract that
 * calls it proves the two agree, not that either matches Hedera. This file is
 * where that assumption gets checked against the real precompile at `0x167`,
 * through `@hashgraph/system-contracts-forking`.
 *
 * It is opt-in because it needs a forked network:
 *
 * ```bash
 * yarn hardhat:test:forking
 * ```
 *
 * Without `HEDERA_FORKING=true` the plugin is not loaded and `0x167` is an empty
 * address, so every case here would fail for a reason that has nothing to do
 * with the code. Rather than fail confusingly, the suite skips itself and says
 * why — a skipped test that explains itself is more honest than a green one that
 * never ran.
 *
 * The lesson that motivated this file: the mirror node query in
 * `packages/indexer` passed 143 tests against a permissive test double and then
 * failed immediately against the real service. Doubles drift from what they
 * stand in for, and only contact with the real thing finds it.
 */
const FORKING_ENABLED = process.env.HEDERA_FORKING === "true";

/** HTS system contract address on every Hedera network. */
const HTS_PRECOMPILE = "0x0000000000000000000000000000000000000167";

describe("PassportRegistry against the real HTS system contract", function () {
  // Forked calls cross a real network boundary; the default 2s timeout is not enough.
  this.timeout(120_000);

  before(function () {
    if (!FORKING_ENABLED) {
      console.log(
        "      skipped — run `yarn hardhat:test:forking` to exercise the real 0x167 precompile.\n" +
          "      `yarn hardhat:test` covers the same paths against MockHTS.",
      );
      this.skip();
    }
  });

  it("finds real code at the system contract address", async function () {
    // If this fails, the fork is not active and nothing below would mean
    // anything — better to say so here than to let later failures look like
    // contract bugs.
    const code = await ethers.provider.getCode(HTS_PRECOMPILE);
    expect(code, "no code at 0x167 — is the fork running?").to.not.equal("0x");
  });

  it("deploys against the real precompile address", async function () {
    const [owner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PassportRegistry");

    // Zero selects DEFAULT_HTS, which is the real 0x167 rather than a mock.
    const registry = await factory.deploy(owner.address, ethers.ZeroAddress);
    await registry.waitForDeployment();

    expect(await registry.HTS()).to.equal(HTS_PRECOMPILE);
    expect(await registry.collection()).to.equal(ethers.ZeroAddress);
  });

  it("refuses to create a collection with no creation fee", async function () {
    const [owner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PassportRegistry");
    const registry = await factory.deploy(owner.address, ethers.ZeroAddress);
    await registry.waitForDeployment();

    // Deliberately not asserting `HtsCreateFailed`. On Hedera proper, HTS
    // returns a non-SUCCESS response code and the contract turns it into that
    // custom error. The forking plugin short-circuits earlier with a plain
    // revert string, so asserting the custom error here would be testing the
    // emulator's shape rather than the contract's. What matters on a fork is
    // that an unpaid creation cannot succeed.
    await expect(registry.createCollection("Product Passports", "PASS", { value: 0 })).to.be.reverted;
  });

  it("documents where the forking plugin stops short of real HTS", async function () {
    const [owner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PassportRegistry");
    const registry = await factory.deploy(owner.address, ethers.ZeroAddress);
    await registry.waitForDeployment();

    const fee = ethers.parseUnits("20", 8);
    await (await registry.createCollection("Product Passports", "PASS", { value: fee })).wait();
    expect(await registry.collection()).to.not.equal(ethers.ZeroAddress);

    // @hashgraph/system-contracts-forking 0.1.2 cannot emulate NFT minting —
    // `mintToken(token, 0, metadata[])` reverts with "mintToken: invalid
    // amount". That gap is the entire reason MockHTS.sol exists, and its header
    // says so.
    //
    // This asserts the limitation rather than skipping past it, so the day the
    // plugin gains support this test fails and tells us to cover minting here
    // properly instead of only against the mock.
    const metadata = ethers.toUtf8Bytes("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");
    const productHash = ethers.keccak256(ethers.toUtf8Bytes("forked-product"));

    let mintSucceeded = false;
    try {
      await (await registry.registerProduct(metadata, productHash, "0.0.1234")).wait();
      mintSucceeded = true;
    } catch (error) {
      expect(String(error), "the plugin failed for a new reason — check whether NFT minting is now supported").to.match(
        /mintToken: invalid amount/,
      );
    }

    expect(
      mintSucceeded,
      "the forking plugin now supports NFT minting — extend this suite to cover registerProduct, " +
        "transferCustody and airdropPassport against the real precompile",
    ).to.equal(false);
  });
});
