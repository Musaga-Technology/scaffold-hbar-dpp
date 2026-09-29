/**
 * Resolving the two ways Hedera accounts are written.
 *
 * SERVER ONLY. Wallets speak EVM addresses; the mirror node reports custody in
 * `0.0.x` account ids. Anything compared against the ledger has to be in the
 * ledger's form — a custody claim naming `0x…` could never match a transfer the
 * mirror node reports as `0.0.x`, and the passport would accuse a genuine
 * hand-over of being a forgery.
 */
import "server-only";

/** Accepts `0.0.x`; an EVM address is resolved through the mirror node. */
export async function resolveAccountId(
  receiver: string,
  network: string,
): Promise<{ accountId?: string; error?: string }> {
  if (/^\d+\.\d+\.\d+$/.test(receiver)) return { accountId: receiver };

  if (!/^0x[0-9a-fA-F]{40}$/.test(receiver)) {
    return { error: `"${receiver}" is neither a Hedera account id (0.0.x) nor an EVM address.` };
  }

  const response = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/accounts/${receiver}`);
  if (response.status === 404) {
    return {
      error:
        `No Hedera account exists for ${receiver} yet. An EVM address only becomes an account once it has ` +
        "been funded or received a transfer; ask the recipient for their 0.0.x id instead.",
    };
  }
  if (!response.ok) {
    return { error: `Could not resolve ${receiver} through the mirror node: ${response.status}.` };
  }

  const body = (await response.json()) as { account?: string };
  return body.account ? { accountId: body.account } : { error: `Mirror node returned no account for ${receiver}.` };
}
