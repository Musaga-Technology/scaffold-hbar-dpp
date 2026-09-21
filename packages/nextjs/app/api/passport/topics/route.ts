import { fail, guard, ok } from "../_lib/responses";
import { TopicCreateTransaction } from "@hiero-ledger/sdk";
import { OperatorUnavailableError, createOperatorClient } from "~~/services/hederaClient";

/** Request body for creating a product's lifecycle topic. */
interface CreateTopicRequest {
  tokenId?: unknown;
  serial?: unknown;
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

      return ok({ topicId, network: operator.network }, 201);
    } finally {
      // A client holds gRPC connections; leaking them exhausts sockets.
      client.close();
    }
  });
}
