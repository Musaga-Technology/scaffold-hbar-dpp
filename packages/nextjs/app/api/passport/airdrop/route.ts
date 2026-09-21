import { fail, guard, ok } from "../_lib/responses";
import { AccountId, TokenAirdropTransaction, TokenId } from "@hiero-ledger/sdk";
import { OperatorUnavailableError, createOperatorClient } from "~~/services/hederaClient";

/**
 * Sends a passport to a consumer using HIP-904.
 *
 * This is the journey a Digital Product Passport exists for: somebody buys the
 * physical thing and ends up holding the record of it. On Hedera that is
 * normally blocked by token association — a receiver must associate a token
 * before they can hold it, which means asking a consumer to perform a
 * blockchain operation before they can be given something.
 *
 * HIP-904 removes that. `TokenAirdropTransaction` either delivers immediately,
 * when the receiver has an open automatic-association slot, or parks the
 * transfer as a *pending airdrop* the receiver can claim later. Either way the
 * sender does not have to wait for the receiver to prepare.
 *
 * The response says which of the two happened, because they are meaningfully
 * different: "delivered" means the consumer holds it now, "pending" means they
 * hold nothing until they claim. Reporting both as success would be a lie of
 * the kind this template is otherwise careful to avoid.
 *
 * Only the current holder can send. That is the operator here — this route is
 * for passports still held by the issuer's operator account. A holder who is a
 * wallet uses `transferCustody` on the contract instead.
 */
interface AirdropRequest {
  tokenId?: unknown;
  serial?: unknown;
  receiver?: unknown;
}

/** Accepts `0.0.x`; an EVM address is resolved through the mirror node. */
async function resolveAccountId(receiver: string, network: string): Promise<{ accountId?: string; error?: string }> {
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

export async function POST(request: Request) {
  return guard(async () => {
    let body: AirdropRequest;
    try {
      body = (await request.json()) as AirdropRequest;
    } catch {
      return fail("invalid_request", "Request body must be JSON.");
    }

    const issues: Array<{ field: string; message: string }> = [];
    if (typeof body.tokenId !== "string" || !/^\d+\.\d+\.\d+$/.test(body.tokenId)) {
      issues.push({ field: "tokenId", message: "must look like 0.0.x" });
    }
    if (!Number.isInteger(body.serial) || (body.serial as number) < 1) {
      issues.push({ field: "serial", message: "must be a positive integer" });
    }
    if (typeof body.receiver !== "string" || body.receiver === "") {
      issues.push({ field: "receiver", message: "must be a Hedera account id or an EVM address" });
    }
    if (issues.length > 0) {
      return fail("invalid_request", "Cannot send this passport.", issues);
    }

    let client;
    let operator;
    try {
      ({ client, operator } = createOperatorClient());
    } catch (error) {
      if (error instanceof OperatorUnavailableError) return fail("operator_unavailable", error.message);
      throw error;
    }

    try {
      const resolved = await resolveAccountId(body.receiver as string, operator.network);
      if (!resolved.accountId) return fail("invalid_request", resolved.error!);

      const tokenId = TokenId.fromString(body.tokenId as string);
      const sender = AccountId.fromString(operator.accountId);
      const receiver = AccountId.fromString(resolved.accountId);

      const response = await new TokenAirdropTransaction()
        .addNftTransfer(tokenId, body.serial as number, sender, receiver)
        .execute(client);
      const record = await response.getRecord(client);

      // A pending airdrop means the receiver has no automatic-association slot
      // free. They hold nothing until they claim it, and the UI must say so.
      const pending = record.newPendingAirdrops ?? [];
      const delivered = pending.length === 0;

      return ok(
        {
          delivered,
          transactionId: response.transactionId.toString(),
          receiver: resolved.accountId,
          serial: body.serial,
          tokenId: body.tokenId,
          network: operator.network,
          pendingCount: pending.length,
          note: delivered
            ? "Delivered. The receiver holds this passport now."
            : "Parked as a pending airdrop. The receiver holds nothing until they claim it — they can do so " +
              "from their wallet, or from /my-passports.",
        },
        201,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      // HIP-904 is not available on every network, and a template should say so
      // rather than leaving a raw status code. The contract's transferNFT path
      // is the documented fallback when the receiver is already associated.
      if (/NOT_SUPPORTED|INVALID_TRANSACTION_BODY/i.test(detail)) {
        return fail(
          "internal",
          `Airdrop was rejected (${detail}). If HIP-904 is unavailable on this network, use the registry's ` +
            "airdropPassport, which performs a direct transfer and requires the receiver to be associated.",
        );
      }

      return fail("internal", `Airdrop failed: ${detail}`);
    } finally {
      client.close();
    }
  });
}

/**
 * Lists a receiver's pending airdrops.
 *
 * Read-only and unauthenticated: pending airdrops are public mirror node data,
 * and a consumer needs to see what is waiting for them before they connect
 * anything.
 */
export async function GET(request: Request) {
  return guard(async () => {
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (!accountId || !/^\d+\.\d+\.\d+$/.test(accountId)) {
      return fail("invalid_request", "Pass ?accountId=0.0.x");
    }

    const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? "testnet";
    const response = await fetch(
      `https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}/airdrops/pending`,
    );

    if (!response.ok) {
      return fail("index_unavailable", `Mirror node returned ${response.status} for pending airdrops.`);
    }

    const body = (await response.json()) as { airdrops?: unknown[] };
    return ok({ pending: body.airdrops ?? [] });
  });
}
