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
    console.log("🚫️ You don't have a deployer account. Run `yarn hardhat:account:generate` first,");
    console.log("   then fund it at https://portal.hedera.com/faucet");
    return;
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
