/**
 * Zero-to-testnet bootstrap.
 *
 * One command takes a funded account to a live, verifiable passport: deploy the
 * registry, create the HTS collection, create the demo product's HCS topic,
 * register the product, and submit its first lifecycle events.
 *
 * Every step is idempotent and recorded in `passport.state.json`, so a run that
 * fails halfway can simply be re-run — finished steps are skipped and not paid
 * for twice.
 *
 * Run it through `yarn passport:bootstrap`, which decrypts the deployer key
 * first. Running this file directly works only if __RUNTIME_DEPLOYER_PRIVATE_KEY
 * is already exported.
 */
import * as dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";

import {
  fetchAccountByEvmAddress,
  fetchTokenIdByAddress,
  hashscan,
  mirrorNodeUrl,
  resolveNetwork,
  waitForMirror,
  type HederaNetwork,
} from "./lib/hedera";
import {
  assessFunding,
  describeShortfall,
  formatHbar,
  hbarToTinybar,
  isWellKnownTestAddress,
  resolveCollectionFeeHbar,
  tinybarToHbar,
} from "./lib/preflight";
import { STATE_FILENAME, readState, startNewProduct, writeState, type PassportState } from "./lib/state";
import { buildEvent, sha256Hex } from "./lib/events";
import {
  DEMO_CATEGORY,
  DEMO_DOCUMENT,
  DEMO_EVENTS,
  DEMO_PRODUCT,
  SHARED_DEMO_DOCUMENT_CID,
  demoMetadataUrl,
  demoProductHash,
} from "./lib/demoProduct";
import { mergeEnvFile, operatorIdEntry, readEnvValue } from "./lib/envFile";
import { buildHip412Metadata, checkMetadataPointer, METADATA_POINTER_MAX_BYTES } from "./lib/metadata";
import { canPin, pinFile, pinJson, rawCid } from "./lib/storage";

const COLLECTION_NAME = "Product Passports";
const COLLECTION_SYMBOL = "PASS";
const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "..", "..");

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Resolves the operator credentials used for all HCS work. */
async function resolveOperator(
  network: HederaNetwork,
  deployerAddress: string,
): Promise<{ accountId: string; privateKey: PrivateKey; derived: boolean }> {
  const explicitId = process.env.HEDERA_OPERATOR_ID;
  const explicitKey = process.env.HEDERA_OPERATOR_PRIVATE_KEY;

  if (explicitId && explicitKey) {
    return {
      accountId: explicitId,
      privateKey: PrivateKey.fromStringECDSA(explicitKey),
      derived: false,
    };
  }

  // Fall back to the deployer's own ECDSA key. Its account id is not derivable
  // offline, so ask the mirror node which account that EVM address belongs to.
  const deployerKey = process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) {
    throw new Error(
      "No operator credentials. Either set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_PRIVATE_KEY in\n" +
        "packages/hardhat/.env, or run this through `yarn passport:bootstrap` so the deployer key is decrypted.",
    );
  }

  const account = await fetchAccountByEvmAddress(mirrorNodeUrl(network), deployerAddress);
  if (!account?.account) {
    throw new Error(
      `The mirror node has no account for ${deployerAddress} on ${network}.\n` +
        "Fund it at https://portal.hedera.com/faucet — an account only exists once it has been funded.",
    );
  }

  return {
    accountId: account.account,
    privateKey: PrivateKey.fromStringECDSA(deployerKey),
    derived: true,
  };
}

/**
 * Sets the bootstrap's keys in an .env.local file, keeping everything else in it.
 * Rewriting the file wholesale used to wipe values developers had added, such
 * as PINATA_JWT, on every successful run.
 */
function writeEnvLocal(filePath: string, entries: Record<string, string>, note: string): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, mergeEnvFile(existing, entries, note), "utf8");
  console.log(`  updated ${path.relative(REPO_ROOT, filePath)}`);
}

async function main(): Promise<void> {
  const network = resolveNetwork(hre.network.name, hre.network.config.chainId);
  const mirror = mirrorNodeUrl(network);
  const statePath = path.join(WORKSPACE_ROOT, STATE_FILENAME);
  const state: PassportState = readState(statePath, hre.network.name);
  if (process.env.BOOTSTRAP_NEW_PRODUCT === "true") {
    const previous = state.serial;
    if (startNewProduct(state)) {
      console.log(`Keeping serial ${previous} and registering a new demo product alongside it.`);
    } else if (previous !== undefined || state.topicId) {
      console.log("The last product was left unfinished — finishing it before starting another.");
    }
  }

  const { deployer } = await hre.getNamedAccounts();
  const collectionFeeHbar = resolveCollectionFeeHbar(process.env.BOOTSTRAP_COLLECTION_FEE_HBAR);

  heading(`Bootstrapping product-passport on ${network}`);
  console.log(`  deployer: ${deployer}`);

  // Refuse before anything is deployed or paid for. Reached by running this
  // script directly instead of through `yarn passport:bootstrap`, which
  // decrypts the real key: hardhat.config falls back to the public Hardhat test
  // key, and that account happens to be funded on Hedera testnet, so the run
  // would otherwise succeed and hand the registry to a key everybody has.
  if (isWellKnownTestAddress(deployer)) {
    throw new Error(
      `The deployer is ${deployer}, the public Hardhat test account. Its private key is in every\n` +
        "Hardhat tutorial, so anything deployed with it belongs to whoever wants it.\n\n" +
        "Run `yarn passport:bootstrap`, which decrypts your own key, rather than calling this script\n" +
        "directly. If you meant to use your own account, run `yarn hardhat:account:generate` or\n" +
        "`yarn hardhat:account:import` first.",
    );
  }

  // ---------------------------------------------------------------- preflight
  const balanceTinybar = await hre.ethers.provider.getBalance(deployer);
  // Hedera reports EVM balances in weibars (18 decimals); tinybars are 8.
  const balanceHbar = tinybarToHbar(balanceTinybar / 10_000_000_000n);

  let registryAddress = state.registryAddress;
  // Where the address came from, so "reusing 0x…" is not mysterious. Deleting
  // passport.state.json alone does not give a fresh registry: hardhat-deploy's
  // artifact is the fallback, and it is easy to delete one and not the other.
  let registrySource = registryAddress ? "passport.state.json" : undefined;
  if (!registryAddress) {
    const existing = await hre.deployments.getOrNull("PassportRegistry");
    registryAddress = existing?.address;
    if (registryAddress) registrySource = `deployments/${hre.network.name}`;
  }

  let collectionAddress = state.collectionAddress;
  if (registryAddress && !collectionAddress) {
    const probe = await hre.ethers.getContractAt("PassportRegistry", registryAddress);
    const onChain = await probe.collection();
    if (onChain !== hre.ethers.ZeroAddress) collectionAddress = onChain;
  }

  const work = {
    needsDeploy: !registryAddress,
    needsCollection: !collectionAddress,
    needsTopic: !state.topicId,
    collectionFeeHbar,
  };

  const assessment = assessFunding(balanceHbar, work);
  console.log(`  balance:  ${formatHbar(balanceHbar)}`);
  if (assessment.breakdown.length === 0) {
    console.log("  nothing left to pay for — everything already exists");
  } else {
    console.log(`  needs:    ${formatHbar(assessment.requiredHbar)}`);
  }

  if (!assessment.sufficient) {
    console.error(`\n${describeShortfall(balanceHbar, assessment)}`);
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------------------ deploy
  heading("1. Registry contract");
  if (work.needsDeploy) {
    // The extended deploy task also regenerates packages/nextjs/contracts/deployedContracts.ts.
    await hre.run("deploy", { tags: "PassportRegistry" });
    const deployment = await hre.deployments.get("PassportRegistry");
    registryAddress = deployment.address;
    console.log(`  deployed at ${registryAddress}`);
  } else {
    console.log(`  reusing ${registryAddress} (from ${registrySource})`);
  }
  state.registryAddress = registryAddress;
  state.deployerAddress = deployer;
  writeState(statePath, state);

  const registry = await hre.ethers.getContractAt("PassportRegistry", registryAddress!);

  // -------------------------------------------------------------- collection
  heading("2. HTS collection");
  if (!collectionAddress) {
    console.log(`  creating, forwarding ${formatHbar(collectionFeeHbar)} for the token creation fee`);
    const tx = await registry.createCollection(COLLECTION_NAME, COLLECTION_SYMBOL, {
      value: hbarToTinybar(collectionFeeHbar) * 10_000_000_000n,
      gasLimit: 2_000_000,
    });
    await tx.wait();
    collectionAddress = await registry.collection();
    console.log(`  created ${collectionAddress}`);
  } else {
    console.log(`  reusing ${collectionAddress}`);
  }
  state.collectionAddress = collectionAddress;

  const tokenId = state.tokenId ?? (await waitForMirror(() => fetchTokenIdByAddress(mirror, collectionAddress!)));
  if (!tokenId) {
    throw new Error(
      `The mirror node has not indexed the collection at ${collectionAddress} yet.\n` +
        "Wait a few seconds and re-run — the collection itself was created successfully.",
    );
  }
  state.tokenId = tokenId;
  writeState(statePath, state);
  console.log(`  token id ${tokenId}`);

  // ------------------------------------------------------------- HCS + product
  heading("3. Demo product");
  const operator = await resolveOperator(network, deployer);
  if (operator.derived) {
    console.log(`  operator ${operator.accountId} (derived from the deployer key)`);
  } else {
    console.log(`  operator ${operator.accountId} (from HEDERA_OPERATOR_ID)`);
  }

  const client = Client.forName(network).setOperator(operator.accountId, operator.privateKey);

  try {
    if (!state.topicId) {
      const receipt = await (
        await new TopicCreateTransaction()
          .setTopicMemo(`passport:${tokenId}:pending`)
          .setSubmitKey(operator.privateKey.publicKey)
          .execute(client)
      ).getReceipt(client);
      state.topicId = receipt.topicId!.toString();
      writeState(statePath, state);
      console.log(`  topic ${state.topicId}`);
    } else {
      console.log(`  reusing topic ${state.topicId}`);
    }

    if (state.serial === undefined) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const productHash = `0x${demoProductHash()}`;

      // Prefer a content address. An app URL makes the token's identity depend
      // on that app staying online, which is a poor property for a record meant
      // to outlive the product.
      let pointer = demoMetadataUrl(appUrl, state.topicId!);
      if (canPin()) {
        const cid = await pinJson(
          buildHip412Metadata({
            category: DEMO_CATEGORY,
            topicId: state.topicId!,
            productHash: demoProductHash(),
            fields: { ...DEMO_PRODUCT },
          }),
        );
        if (cid) {
          pointer = `ipfs://${cid}`;
          console.log(`  metadata pinned ${pointer}`);
        }
      } else {
        console.log("  metadata will be served by the app (set PINATA_JWT to pin it to IPFS instead)");
      }

      const pointerSize = checkMetadataPointer(pointer);
      if (!pointerSize.fits) {
        throw new Error(
          `The metadata pointer is ${pointerSize.bytes} bytes, over the registry's ${METADATA_POINTER_MAX_BYTES}-byte limit.\n` +
            "Set PINATA_JWT so it can be a short ipfs:// reference, or shorten NEXT_PUBLIC_APP_URL.",
        );
      }

      const metadata = hre.ethers.toUtf8Bytes(pointer);

      const tx = await registry.registerProduct(metadata, productHash, state.topicId, { gasLimit: 1_500_000 });
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map(log => {
          try {
            return registry.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(parsed => parsed?.name === "ProductRegistered");

      if (!event) throw new Error("registerProduct succeeded but emitted no ProductRegistered event.");

      state.serial = Number(event.args.serial);
      state.registerTxHash = receipt!.hash;
      state.metadataPointer = pointer;
      writeState(statePath, state);
      console.log(`  registered serial ${state.serial}`);
    } else {
      console.log(`  reusing serial ${state.serial}`);
    }

    // --------------------------------------------------------------- events
    if (!state.eventTransactionIds?.length) {
      heading("4. Lifecycle events");
      const transactionIds: string[] = [];
      const actor = deployer;

      // Attach a real document to the inspection, content-addressed. The CID is
      // computed here, so the event can only ever commit an address that names
      // these exact bytes. With a storage key it is pinned to the developer's
      // own account and Pinata's answer checked against it. Without one, the
      // same document is already on IPFS — its content, and so its CID, is
      // identical in every bootstrap — so it is attached by reference and the
      // indexer verifies it exactly the same way.
      const bytes = new TextEncoder().encode(DEMO_DOCUMENT.body);
      const hash = sha256Hex(DEMO_DOCUMENT.body);
      let cid: string | undefined;
      if (canPin()) {
        cid = await pinFile(bytes, DEMO_DOCUMENT.name, DEMO_DOCUMENT.type);
        if (cid) console.log(`  document pinned ipfs://${cid}`);
      } else {
        // Never abort here: the product is already minted, and a half-finished
        // run is worse than a passport without a document. The unit test pins
        // SHARED_DEMO_DOCUMENT_CID to these bytes, which is where drift fails.
        if (rawCid(bytes) === SHARED_DEMO_DOCUMENT_CID) {
          cid = SHARED_DEMO_DOCUMENT_CID;
          console.log(`  document ipfs://${cid} (the shared sample, already on IPFS)`);
          console.log("           set PINATA_JWT to pin documents to your own account instead");
        } else {
          console.log("  no document attached: the demo document changed and is not on IPFS; set PINATA_JWT to pin it");
        }
      }
      const attachments = cid
        ? [{ cid, hash, name: DEMO_DOCUMENT.name, type: DEMO_DOCUMENT.type, bytes: bytes.byteLength }]
        : [];
      if (cid) {
        state.documentCid = cid;
        writeState(statePath, state);
      }

      const registration = buildEvent({
        type: "product.registered",
        serial: state.serial,
        tokenId,
        actor,
        payload: { category: DEMO_CATEGORY, ...DEMO_PRODUCT },
        ref: state.registerTxHash,
      });

      const messages = [
        registration,
        ...DEMO_EVENTS.map(demo =>
          buildEvent({
            type: demo.type,
            serial: state.serial!,
            tokenId,
            actor,
            payload:
              demo.type === "product.inspected" && attachments.length > 0
                ? { ...demo.payload, attachments }
                : demo.payload,
          }),
        ),
      ];

      for (const { event, message } of messages) {
        const response = await new TopicMessageSubmitTransaction()
          .setTopicId(state.topicId!)
          .setMessage(message)
          .execute(client);
        await response.getReceipt(client);
        transactionIds.push(response.transactionId.toString());
        console.log(`  ${event.type.padEnd(20)} ${Buffer.byteLength(message, "utf8")} bytes`);
      }

      state.eventTransactionIds = transactionIds;
      writeState(statePath, state);
    } else {
      heading("4. Lifecycle events");
      console.log(`  reusing ${state.eventTransactionIds.length} already-submitted events`);
    }
  } finally {
    client.close();
  }

  // ----------------------------------------------------------------- env files
  heading("5. Configuration");
  const indexApiUrl = process.env.INDEX_API_URL ?? `http://localhost:${process.env.INDEXER_PORT ?? 3001}`;
  const appEnvPath = path.join(REPO_ROOT, "packages", "nextjs", ".env.local");
  const appEnv = fs.existsSync(appEnvPath) ? fs.readFileSync(appEnvPath, "utf8") : "";

  writeEnvLocal(
    appEnvPath,
    {
      // Public, so the bootstrap fills it in, but only if unset: see
      // operatorIdEntry. The key stays with the developer.
      ...operatorIdEntry(appEnv, operator.accountId),
      NEXT_PUBLIC_PASSPORT_REGISTRY_ADDRESS: state.registryAddress!,
      NEXT_PUBLIC_PASSPORT_TOKEN_ID: tokenId,
      NEXT_PUBLIC_HEDERA_NETWORK: network,
      // Without this the app keeps serving bundled demo fixtures, so a
      // successful bootstrap would look like it had done nothing: the freshly
      // registered product would be invisible and /verify/1 would still show
      // the demo battery.
      INDEX_API_URL: indexApiUrl,
    },
    "Public values only — never the operator key, which you add yourself.",
  );
  writeEnvLocal(
    path.join(REPO_ROOT, "packages", "indexer", ".env.local"),
    {
      HEDERA_NETWORK: network,
      PASSPORT_REGISTRY_ADDRESS: state.registryAddress!,
      // Deliberately empty. An explicit list takes precedence over discovering
      // products from the registry's ProductRegistered logs, and writing one
      // here meant every product registered afterwards — through the issuer
      // page, or another bootstrap run — was never indexed. Empty, the indexer
      // follows the registry and picks up new products as they appear.
      INDEXER_TOPIC_IDS: "",
    },
    "The indexer only ever reads; it needs no key.",
  );

  // -------------------------------------------------------------------- done
  heading("Live on Hedera");
  console.log(`  contract  ${hashscan.contract(network, state.registryAddress!)}`);
  console.log(`  token     ${hashscan.token(network, tokenId)}`);
  console.log(`  serial    ${hashscan.serial(network, tokenId, state.serial!)}`);
  console.log(`  topic     ${hashscan.topic(network, state.topicId!)}`);

  if (process.env.BOOTSTRAP_NEW_PRODUCT !== "true" && assessment.breakdown.length === 0) {
    console.log("\nEverything already existed, so nothing was registered.");
    console.log("  http://localhost:3000/issuer   register your own products here");
    console.log("  yarn passport:new-product      or add another demo product from the CLI");
  }

  // The one step the bootstrap deliberately leaves to the developer.
  const appEnvAfter = fs.existsSync(appEnvPath) ? fs.readFileSync(appEnvPath, "utf8") : "";
  if (!readEnvValue(appEnvAfter, "HEDERA_OPERATOR_PRIVATE_KEY")) {
    console.log("\nTo register products from the issuer page, add the operator's key to");
    console.log(
      `packages/nextjs/.env.local — HEDERA_OPERATOR_ID is already set to ${readEnvValue(appEnvAfter, "HEDERA_OPERATOR_ID")}:`,
    );
    console.log("  yarn hardhat:account:reveal-pk     # prints it after asking for your password");
    console.log("  HEDERA_OPERATOR_PRIVATE_KEY=0x…    # add this line; never prefix it NEXT_PUBLIC_");
  }

  console.log("\nNext:");
  // An indexer started before this run holds the old configuration and will not
  // see the product just registered until it is restarted.
  console.log("  yarn indexer:dev      # index it and reconcile custody (restart it if already running)");
  console.log("  yarn next:start       # then open the passport");
  console.log(`\n  http://localhost:3000/verify/${state.serial}\n`);
}

main().catch(error => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
