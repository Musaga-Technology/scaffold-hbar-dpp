/**
 * Server-side reads of the registry contract.
 *
 * SERVER ONLY. This exists for one reason: `setEventLogger` writes an allow-list
 * to the chain, and an allow-list nothing reads is decoration. HCS topics are
 * append-only and the contract cannot police them, so the only party who *can*
 * enforce it is whoever holds the topic's submit key — which is this server.
 *
 * Before this module existed, the contract's own NatSpec claimed the server
 * route enforced the allow-list. It did not. That was a worse defect than a
 * missing feature: a developer reading the contract would reasonably believe
 * their allow-list did something.
 */
import "server-only";
import { type Address, createPublicClient, http } from "viem";
import { hederaTestnet } from "viem/chains";

/** The reads this server needs. */
const REGISTRY_ABI = [
  {
    type: "function",
    name: "isEventLogger",
    stateMutability: "view",
    inputs: [
      { name: "serial", type: "int64" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "allowed", type: "bool" }],
  },
] as const;

/** Why an event submission was refused, in a form a route can return. */
export type LoggerCheck =
  | { allowed: true; enforced: boolean; reason?: string }
  | { allowed: false; enforced: true; reason: string };

function registryAddress(): Address | undefined {
  const raw = process.env.NEXT_PUBLIC_PASSPORT_REGISTRY_ADDRESS;
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as Address) : undefined;
}

function rpcUrl(): string {
  return (
    process.env.HEDERA_RPC_URL ?? process.env.NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL ?? "https://testnet.hashio.io/api"
  );
}

/**
 * Checks whether an account may log events for a serial.
 *
 * Returns `allowed` with `enforced: false` when no registry is configured —
 * which is the demo case, where there is no allow-list to consult and refusing
 * would break a template that is meant to run with no configuration at all. The
 * caller reports which of the two happened rather than letting "allowed" mean
 * two different things.
 *
 * A chain read that fails is treated as allowed-but-unenforced rather than as a
 * refusal: an RPC outage should not silently become an authorisation failure,
 * which would send a developer hunting through their allow-list for a problem
 * that is not there.
 *
 * @param serial Serial the event is about.
 * @param actor Account proposing to log it.
 * @returns Whether to proceed, and whether the answer was actually enforced.
 */
export async function checkEventLogger(serial: number, actor: string): Promise<LoggerCheck> {
  const address = registryAddress();

  if (!address) {
    return {
      allowed: true,
      enforced: false,
      reason: "No registry configured, so the on-chain event-logger allow-list was not consulted.",
    };
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(actor)) {
    // The allow-list is keyed by EVM address. A Hedera account id cannot be
    // checked against it here, and guessing would be worse than saying so.
    return {
      allowed: true,
      enforced: false,
      reason: `Actor ${actor} is not an EVM address, so the allow-list could not be checked.`,
    };
  }

  try {
    const client = createPublicClient({ chain: hederaTestnet, transport: http(rpcUrl()) });
    const allowed = await client.readContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "isEventLogger",
      args: [BigInt(serial), actor as Address],
    });

    if (allowed) return { allowed: true, enforced: true };

    return {
      allowed: false,
      enforced: true,
      reason:
        `${actor} is not permitted to log events for serial ${serial}. The registry's owner or the ` +
        `product's issuer can grant this with setEventLogger(${serial}, ${actor}, true).`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      allowed: true,
      enforced: false,
      reason: `Could not read the allow-list from the registry (${detail}), so it was not enforced.`,
    };
  }
}
