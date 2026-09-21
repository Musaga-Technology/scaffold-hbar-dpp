import { expect } from "chai";
import { ethers } from "hardhat";

const TOPIC_ID = "0.0.12345";
const PRODUCT_HASH = ethers.keccak256(ethers.toUtf8Bytes("demo-product"));
const METADATA = ethers.toUtf8Bytes("https://example.com/p/1.json");

describe("PassportRegistry", function () {
  async function deployFixture() {
    const [owner, issuer, holder, consumer, stranger] = await ethers.getSigners();

    // MockHTS stands in for the system contract at 0x167; it also deploys an
    // ERC-721 facade per collection, so ownerOf behaves as it does on Hedera.
    const MockHTS = await ethers.getContractFactory("MockHTS");
    const mockHTS = await MockHTS.deploy();
    await mockHTS.waitForDeployment();

    const PassportRegistry = await ethers.getContractFactory("PassportRegistry");
    const registry = await PassportRegistry.deploy(owner.address, await mockHTS.getAddress());
    await registry.waitForDeployment();

    return { registry, mockHTS, owner, issuer, holder, consumer, stranger };
  }

  /** Deploys, creates the collection and registers one product held by the treasury. */
  async function registeredFixture() {
    const base = await deployFixture();
    await base.registry.createCollection("Product Passports", "PASS");
    await base.registry.registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID);
    return { ...base, serial: 1n };
  }

  describe("createCollection", function () {
    it("creates the collection once and records its address", async function () {
      const { registry } = await deployFixture();

      await expect(registry.createCollection("Product Passports", "PASS")).to.emit(registry, "CollectionCreated");
      expect(await registry.collection()).to.not.equal(ethers.ZeroAddress);
    });

    it("reverts when called a second time", async function () {
      const { registry } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      await expect(registry.createCollection("Again", "AGN")).to.be.revertedWithCustomError(
        registry,
        "CollectionAlreadyCreated",
      );
    });

    it("reverts for a non-owner", async function () {
      const { registry, stranger } = await deployFixture();

      await expect(
        registry.connect(stranger).createCollection("Product Passports", "PASS"),
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("reverts on an empty name or symbol", async function () {
      const { registry } = await deployFixture();

      await expect(registry.createCollection("", "PASS")).to.be.revertedWithCustomError(registry, "EmptyField");
      await expect(registry.createCollection("Product Passports", "")).to.be.revertedWithCustomError(
        registry,
        "EmptyField",
      );
    });

    it("names the registry as the supply key holder so only it can mint", async function () {
      const { registry, mockHTS } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      const collection = await registry.collection();
      const tokenData = await mockHTS.getTokenData(collection);
      expect(tokenData.supplyKey).to.equal(await registry.getAddress());
      expect(tokenData.treasury).to.equal(await registry.getAddress());

      // Anyone else calling the system contract directly cannot mint into it.
      await expect(mockHTS.mintToken(collection, 0, [METADATA])).to.be.revertedWith(
        "MockHTS: caller does not hold the supply key",
      );
    });
  });

  describe("registerProduct", function () {
    it("mints a serial, stores the record and emits ProductRegistered", async function () {
      const { registry, owner } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      await expect(registry.registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID))
        .to.emit(registry, "ProductRegistered")
        .withArgs(1n, TOPIC_ID, PRODUCT_HASH, owner.address);

      const product = await registry.getProduct(1n);
      expect(product.topicId).to.equal(TOPIC_ID);
      expect(product.productHash).to.equal(PRODUCT_HASH);
      expect(product.issuer).to.equal(owner.address);
      expect(product.exists).to.equal(true);
      expect(await registry.productCount()).to.equal(1n);
    });

    it("leaves the freshly minted serial with the registry treasury", async function () {
      const { registry, serial } = await registeredFixture();
      expect(await registry.currentHolder(serial)).to.equal(await registry.getAddress());
    });

    it("reverts for an account that is not the owner or an allow-listed issuer", async function () {
      const { registry, stranger } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      await expect(registry.connect(stranger).registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID))
        .to.be.revertedWithCustomError(registry, "NotIssuer")
        .withArgs(stranger.address);
    });

    it("lets an allow-listed issuer register, and stops them once revoked", async function () {
      const { registry, issuer } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      await expect(registry.setIssuer(issuer.address, true))
        .to.emit(registry, "IssuerSet")
        .withArgs(issuer.address, true);
      await registry.connect(issuer).registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID);
      expect((await registry.getProduct(1n)).issuer).to.equal(issuer.address);

      await registry.setIssuer(issuer.address, false);
      await expect(
        registry.connect(issuer).registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID),
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("reverts before the collection exists", async function () {
      const { registry } = await deployFixture();

      await expect(registry.registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID)).to.be.revertedWithCustomError(
        registry,
        "CollectionNotCreated",
      );
    });

    it("rejects metadata large enough to be a document rather than a pointer", async function () {
      const { registry } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      const tooLong = ethers.toUtf8Bytes("x".repeat(101));
      await expect(registry.registerProduct(tooLong, PRODUCT_HASH, TOPIC_ID)).to.be.revertedWithCustomError(
        registry,
        "MetadataTooLong",
      );
      await expect(registry.registerProduct("0x", PRODUCT_HASH, TOPIC_ID)).to.be.revertedWithCustomError(
        registry,
        "EmptyField",
      );
    });

    it("rejects a missing topic id or a zero product hash", async function () {
      const { registry } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      await expect(registry.registerProduct(METADATA, PRODUCT_HASH, "")).to.be.revertedWithCustomError(
        registry,
        "InvalidTopicId",
      );
      await expect(registry.registerProduct(METADATA, PRODUCT_HASH, "0".repeat(33))).to.be.revertedWithCustomError(
        registry,
        "InvalidTopicId",
      );
      await expect(registry.registerProduct(METADATA, ethers.ZeroHash, TOPIC_ID)).to.be.revertedWithCustomError(
        registry,
        "InvalidProductHash",
      );
    });

    it("assigns increasing serials across products", async function () {
      const { registry } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");

      await registry.registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID);
      await registry.registerProduct(METADATA, PRODUCT_HASH, "0.0.67890");

      expect(await registry.productCount()).to.equal(2n);
      expect((await registry.getProduct(2n)).topicId).to.equal("0.0.67890");
    });

    it("reverts getProduct for an unregistered serial", async function () {
      const { registry } = await deployFixture();

      await expect(registry.getProduct(99n)).to.be.revertedWithCustomError(registry, "ProductNotFound").withArgs(99n);
    });
  });

  describe("transferCustody", function () {
    it("moves custody when called by the current holder and emits the change", async function () {
      const { registry, holder, consumer, serial } = await registeredFixture();
      await registry.airdropPassport(serial, holder.address);

      await expect(registry.connect(holder).transferCustody(serial, consumer.address))
        .to.emit(registry, "CustodyTransferred")
        .withArgs(serial, holder.address, consumer.address);

      expect(await registry.currentHolder(serial)).to.equal(consumer.address);
    });

    it("reverts for a caller who does not hold the serial", async function () {
      const { registry, holder, stranger, serial } = await registeredFixture();
      await registry.airdropPassport(serial, holder.address);

      await expect(registry.connect(stranger).transferCustody(serial, stranger.address))
        .to.be.revertedWithCustomError(registry, "NotHolder")
        .withArgs(serial, holder.address);
    });

    it("rejects the zero address and a transfer to the current holder", async function () {
      const { registry, holder, serial } = await registeredFixture();
      await registry.airdropPassport(serial, holder.address);

      await expect(registry.connect(holder).transferCustody(serial, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        "InvalidRecipient",
      );
      await expect(registry.connect(holder).transferCustody(serial, holder.address)).to.be.revertedWithCustomError(
        registry,
        "AlreadyHolder",
      );
    });

    it("reverts for an unregistered serial", async function () {
      const { registry, consumer } = await registeredFixture();

      await expect(registry.transferCustody(42n, consumer.address)).to.be.revertedWithCustomError(
        registry,
        "ProductNotFound",
      );
    });
  });

  describe("airdropPassport", function () {
    it("sends a treasury-held passport to a consumer", async function () {
      const { registry, consumer, serial } = await registeredFixture();

      await expect(registry.airdropPassport(serial, consumer.address))
        .to.emit(registry, "PassportAirdropped")
        .withArgs(serial, consumer.address);

      expect(await registry.currentHolder(serial)).to.equal(consumer.address);
    });

    it("also emits CustodyTransferred so the indexer sees one custody story", async function () {
      const { registry, consumer, serial } = await registeredFixture();

      await expect(registry.airdropPassport(serial, consumer.address))
        .to.emit(registry, "CustodyTransferred")
        .withArgs(serial, await registry.getAddress(), consumer.address);
    });

    it("reverts once the passport has left the treasury", async function () {
      const { registry, holder, consumer, serial } = await registeredFixture();
      await registry.airdropPassport(serial, holder.address);

      await expect(registry.airdropPassport(serial, consumer.address))
        .to.be.revertedWithCustomError(registry, "NotTreasuryHeld")
        .withArgs(serial, holder.address);
    });

    it("reverts for an account that is neither the owner nor the product's issuer", async function () {
      const { registry, stranger, consumer, serial } = await registeredFixture();

      await expect(registry.connect(stranger).airdropPassport(serial, consumer.address)).to.be.revertedWithCustomError(
        registry,
        "NotIssuer",
      );
    });
  });

  describe("event logger allow-list", function () {
    it("always permits the owner and the account that registered the product", async function () {
      const { registry, owner, issuer, stranger } = await deployFixture();
      await registry.createCollection("Product Passports", "PASS");
      await registry.setIssuer(issuer.address, true);
      await registry.connect(issuer).registerProduct(METADATA, PRODUCT_HASH, TOPIC_ID);

      expect(await registry.isEventLogger(1n, owner.address)).to.equal(true);
      expect(await registry.isEventLogger(1n, issuer.address)).to.equal(true);
      // Being an allow-listed issuer of *other* products grants nothing here.
      expect(await registry.isEventLogger(1n, stranger.address)).to.equal(false);
    });

    it("grants and revokes a third-party logger", async function () {
      const { registry, stranger, serial } = await registeredFixture();

      expect(await registry.isEventLogger(serial, stranger.address)).to.equal(false);

      await expect(registry.setEventLogger(serial, stranger.address, true))
        .to.emit(registry, "EventLoggerSet")
        .withArgs(serial, stranger.address, true);
      expect(await registry.isEventLogger(serial, stranger.address)).to.equal(true);

      await registry.setEventLogger(serial, stranger.address, false);
      expect(await registry.isEventLogger(serial, stranger.address)).to.equal(false);
    });

    it("reverts when set by an account that does not control the product", async function () {
      const { registry, stranger, consumer, serial } = await registeredFixture();

      await expect(
        registry.connect(stranger).setEventLogger(serial, consumer.address, true),
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("returns false for an unregistered serial rather than reverting", async function () {
      const { registry, stranger } = await registeredFixture();
      expect(await registry.isEventLogger(404n, stranger.address)).to.equal(false);
    });
  });

  describe("setIssuer", function () {
    it("reverts for a non-owner and for the zero address", async function () {
      const { registry, stranger } = await deployFixture();

      await expect(registry.connect(stranger).setIssuer(stranger.address, true)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount",
      );
      await expect(registry.setIssuer(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
        registry,
        "InvalidRecipient",
      );
    });
  });
});
