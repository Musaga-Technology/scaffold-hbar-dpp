import { fail, guard, ok } from "../_lib/responses";
import { TopicCreateTransaction } from "@hiero-ledger/sdk";
import { OperatorUnavailableError, createOperatorClient, operatorProblems } from "~~/services/hederaClient";

/** Request body for creating a product's lifecycle topic. */
interface CreateTopicRequest {
  tokenId?: unknown;
  serial?: unknown;
  /** A topic left by an earlier attempt that never finished, to reuse if safe. */
  reuse?: unknown;
}

/**
 * Whether a topic from a failed registration can be handed out again.
 *
 * Registration creates the topic before the mint, because the mint takes its id
 * as an argument. Every attempt that failed after that — a rejected wallet
 * prompt, a reverted transaction — used to leave a topic behind; five in one
 * afternoon of testing. Reuse is allowed only when all three hold: the memo
 * marks it as this collection's pending topic, it has no messages (a completed
 * registration always writes its first event), and its submit key is this
 * operator's, so events can still be written to it. Anything uncertain means a
 * fresh topic — binding two products to one history would be far worse than a
 * spare topic.
 *
 * Read on the server, never in the browser, which reads HCS only through the
 * index.
 */
async function isReusable(topicId: string, tokenId: string, operatorPublicKey: string, network: string) {
  const mirror = `https://${network}.mirrornode.hedera.com/api/v1/topics/${topicId}`;
  try {
    const [infoResponse, messagesResponse] = await Promise.all([fetch(mirror), fetch(`${mirror}/messages?limit=1`)]);
    if (!infoResponse.ok || !messagesResponse.ok) return false;
    const info = (await infoResponse.json()) as { memo?: string; submit_key?: { key?: string } | null };
    const messages = (await messagesResponse.json()) as { messages?: unknown[] };
    return (
      info.memo === `passport:${tokenId}:pending` &&
      Array.isArray(messages.messages) &&
      messages.messages.length === 0 &&
      info.submit_key?.key?.toLowerCase() === operatorPublicKey.toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Creates the HCS topic that carries one product's lifecycle log.
 *
 * The submit key is the operator, so only this server can append to the topic.
 * That is what makes the `setEventLogger` allow-list on the registry meaningful:
 * the contract cannot police an append-only topic, but the holder of the submit
 * key can, and that holder is this route.
 *
 * The memo carries `passport:{tokenId}:{serial}` so a topic found on HashScan
 * can be traced back to its product without consulting the index. During
 * registration the serial is not yet known — the mint that assigns it needs this
 * topic id as an argument — so the memo reads `:pending` until then.
 */
/**
 * Whether this server can create topics and submit events at all.
 *
 * So the issuer pages can say what to configure before someone fills in a form,
 * rather than failing on submit. Reports presence only — nothing about the
 * operator's id or key.
 */
export async function GET() {
  return guard(async () => {
    const problems = operatorProblems();
    return ok({ configured: problems.length === 0, problems });
  });
}

export async function POST(request: Request) {
  return guard(async () => {
    let body: CreateTopicRequest;
    try {
      body = (await request.json()) as CreateTopicRequest;
    } catch {
      return fail("invalid_request", "Request body must be JSON.");
    }

    const issues: Array<{ field: string; message: string }> = [];
    if (typeof body.tokenId !== "string" || !/^\d+\.\d+\.\d+$/.test(body.tokenId)) {
      issues.push({ field: "tokenId", message: "must look like 0.0.x" });
    }
    // The serial is optional by necessity, not convenience: registerProduct
    // takes the topic id as an argument, so the topic has to exist before the
    // mint that assigns the serial. Callers that already know it pass it.
    if (body.serial !== undefined && (!Number.isInteger(body.serial) || (body.serial as number) < 1)) {
      issues.push({ field: "serial", message: "must be a positive integer when present" });
    }
    if (body.reuse !== undefined && (typeof body.reuse !== "string" || !/^\d+\.\d+\.\d+$/.test(body.reuse))) {
      issues.push({ field: "reuse", message: "must look like 0.0.x when present" });
    }
    if (issues.length > 0) {
      return fail("invalid_request", "Cannot create a topic from this request.", issues);
    }

    let client;
    let operator;
    try {
      ({ client, operator } = createOperatorClient());
    } catch (error) {
      if (error instanceof OperatorUnavailableError) {
        return fail("operator_unavailable", error.message);
      }
      throw error;
    }

    try {
      if (
        typeof body.reuse === "string" &&
        body.serial === undefined &&
        (await isReusable(
          body.reuse,
          body.tokenId as string,
          operator.privateKey.publicKey.toStringRaw(),
          operator.network,
        ))
      ) {
        return ok({ topicId: body.reuse, network: operator.network, reused: true });
      }

      const receipt = await (
        await new TopicCreateTransaction()
          .setTopicMemo(`passport:${body.tokenId}:${body.serial ?? "pending"}`)
          .setSubmitKey(operator.privateKey.publicKey)
          .execute(client)
      ).getReceipt(client);

      const topicId = receipt.topicId?.toString();
      if (!topicId) {
        return fail("internal", "Topic creation succeeded but returned no topic id.");
      }

      return ok({ topicId, network: operator.network, reused: false }, 201);
    } finally {
      // A client holds gRPC connections; leaking them exhausts sockets.
      client.close();
    }
  });
}
