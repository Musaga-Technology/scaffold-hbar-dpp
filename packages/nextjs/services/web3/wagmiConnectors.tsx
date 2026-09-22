import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { rainbowkitBurnerWallet } from "burner-connector";
import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

const wallets = [metaMaskWallet, walletConnectWallet];

/**
 * Chains where a burner wallet is offered.
 *
 * Local chains only. It used to include Hedera testnet, where clicking "Connect
 * Wallet" silently connected a generated key with no HBAR and no Hedera
 * account: the register form opened, and every transaction from it would fail.
 * People reasonably read that address as "some default account that is not
 * mine". On a local fork the accounts are funded and a burner is genuinely
 * convenient, so it stays there.
 */
const DEV_CHAIN_IDS = new Set<number>([chains.hardhat.id, chains.foundry.id]);

// The network the app actually starts on, not "is a local chain configured
// anywhere". `hederaLocalFork` spreads `chains.hardhat`, so it carries chain id
// 31337 and made `.some(...)` true even while the app was pointed at Hedera
// testnet — which is how the burner ended up being offered there.
const hasDevNetwork = DEV_CHAIN_IDS.has(scaffoldConfig.targetNetworks[0].id);

export const wagmiConnectors = () => {
  if (typeof window === "undefined") {
    return [];
  }

  const walletGroups = [
    {
      groupName: "Supported Wallets",
      wallets,
    },
  ];

  if (scaffoldConfig.enableBurnerWallet && hasDevNetwork) {
    walletGroups.push({
      groupName: "Development",
      wallets: [rainbowkitBurnerWallet],
    });
  }

  return connectorsForWallets(walletGroups, {
    appName: "scaffold-hbar",
    projectId: scaffoldConfig.walletConnectProjectId,
  });
};
