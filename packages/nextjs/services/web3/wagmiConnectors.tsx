import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { rainbowkitBurnerWallet } from "burner-connector";
import * as chains from "viem/chains";
import { createConnector } from "wagmi";
import { injected } from "wagmi/connectors";
import scaffoldConfig from "~~/scaffold.config";

/**
 * MetaMask, connected through the extension's own injected provider.
 *
 * RainbowKit's metaMaskWallet routes even the installed extension through the
 * MetaMask SDK. Restoring a session through the SDK could hang: wagmi knew the
 * address but sat at "reconnecting", so the header showed a connected wallet
 * while the wallet client never arrived and every write failed with "Cannot
 * access account". The extension injects a standard EIP-1193 provider, and
 * wagmi's injected connector talks to it directly — the path wagmi recommends
 * for browser extensions.
 *
 * Without the extension this changes nothing: RainbowKit's own mobile and QR
 * flow is kept.
 */
const metaMaskExtensionWallet: typeof metaMaskWallet = parameters => {
  const wallet = metaMaskWallet(parameters);
  if (!wallet.installed) return wallet;
  return {
    ...wallet,
    createConnector: walletDetails =>
      createConnector(config => ({ ...injected({ target: "metaMask" })(config), ...walletDetails })),
  };
};

const wallets = [metaMaskExtensionWallet, walletConnectWallet];

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
