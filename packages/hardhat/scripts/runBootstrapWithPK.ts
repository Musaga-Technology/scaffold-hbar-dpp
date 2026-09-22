import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";

/**
 * Decrypts the deployer key and runs the bootstrap against a Hedera network.
 *
 * Mirrors `runHardhatDeployWithPK.ts` so the key is handled exactly one way in
 * this template: decrypted in memory for the life of a single child process and
 * never written anywhere.
 *
 * Accepts the network as either:
 *   - Positional: ts-node runBootstrapWithPK.ts hederaTestnet
 *   - Flag:       ts-node runBootstrapWithPK.ts --network hederaTestnet
 *
 * `--new-product` registers another demo product on the existing registry
 * (`yarn passport:new-product`). A flag rather than asking people to prefix an
 * environment variable: the prefix is easy to drop when copying a command, and
 * does not work in Windows shells at all.
 */
async function main() {
  const networkIndex = process.argv.indexOf("--network");
  const networkName =
    networkIndex !== -1
      ? process.argv[networkIndex + 1]
      : process.argv[2] && !process.argv[2].startsWith("-")
        ? process.argv[2]
        : "hederaTestnet";

  const hardhatArgs = ["run", "scripts/bootstrap.ts", "--network", networkName];
  if (process.argv.includes("--new-product")) process.env.BOOTSTRAP_NEW_PRODUCT = "true";

  const run = () => {
    const hardhat = spawn("hardhat", hardhatArgs, {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    hardhat.on("exit", code => process.exit(code || 0));
  };

  if (networkName === "localhost" || networkName === "hardhat") {
    console.log("The bootstrap targets a real Hedera network — HCS topics and HTS tokens have no local equivalent.");
    console.log("Run it with --network hederaTestnet.");
    process.exit(1);
  }

  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
  if (!encryptedKey) {
    // Two paths reach this point and they need different advice. Naming only
    // the first sends anyone who already made an account at the portal off to
    // create a second one they do not need.
    console.log("🚫️ No deployer account is configured for this workspace.\n");
    console.log("   If you already have a funded Hedera account:");
    console.log("     yarn hardhat:account:import");
    console.log("     …and paste its HEX encoded private key (the 0x… one, not the DER one).\n");
    console.log("   If you do not have one yet:");
    console.log("     yarn hardhat:account:generate");
    console.log("     …then fund the address it prints at https://portal.hedera.com/faucet\n");
    console.log("   Either way the account must be ECDSA, not ED25519 — every EVM flow in this");
    console.log("   template needs ECDSA, and the portal offers both.");
    process.exit(1);
  }

  const pass = await password({ message: "Enter password to decrypt private key:" });

  try {
    const wallet = await Wallet.fromEncryptedJson(encryptedKey, pass);
    process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY = wallet.privateKey;
    run();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    console.error("Failed to decrypt private key. Wrong password?");
    process.exit(1);
  }
}

main().catch(console.error);
