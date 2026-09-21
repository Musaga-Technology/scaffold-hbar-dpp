import { fail, guard, ok } from "../_lib/responses";
import { TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import {
  type EventType,
  type LogEventRequest,
  MAX_EVENT_BYTES,
  buildEvent,
  isKnownEventType,
  validateEvent,
  validateLogEventRequest,
} from "~~/lib/events";
import { OperatorUnavailableError, createOperatorClient } from "~~/services/hederaClient";

/** Request body for appending a lifecycle event to a product's topic. */
interface SubmitEventRequest extends LogEventRequest {
  topicId?: unknown;
}

/**
 * Appends one compact, hash-anchored event to a product's HCS topic.
 *
 * Validation happens in three passes, and all three matter:
 *
 *  1. The caller-supplied fields are checked, because `payloadHash` and `v` are
 *     derived here — validating only the assembled event would leave everything
 *     the caller actually controls unchecked.
 *  2. `buildEvent` refuses payloads that embed content rather than referencing
 *     it, and refuses anything over the 1024-byte HCS limit.
 *  3. The assembled event is validated against the published JSON Schema, which
 *     is the contract every other reader of this topic relies on.
 *
 * Nothing is signed or submitted until all three pass.
 */
export async function POST(request: Request) {
  return guard(async () => {
    let body: SubmitEventRequest;
    try {
      body = (await request.json()) as SubmitEventRequest;
    } catch {
      return fail("invalid_request", "Request body must be JSON.");
    }

    const issues = validateLogEventRequest(body);
    if (typeof body.topicId !== "string" || !/^\d+\.\d+\.\d+$/.test(body.topicId)) {
      issues.push({ field: "topicId", message: "must look like 0.0.x" });
    }
    if (typeof body.type === "string" && !isKnownEventType(body.type)) {
      issues.push({
        field: "type",
        message: "must be a built-in lifecycle type or a custom.* type (lowercase)",
      });
    }
    if (issues.length > 0) {
      return fail("invalid_request", "Cannot build an event from this request.", issues);
    }

    let event;
    let message;
    try {
      ({ event, message } = buildEvent({
        type: body.type as EventType,
        serial: body.serial,
        tokenId: body.tokenId,
        actor: body.actor,
        payload: body.payload,
        ref: body.ref,
        prev: body.prev,
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Distinguish "too big" from "you tried to put a document on HCS": they
      // need different fixes, and a single generic error would hide which.
      return detail.includes(`${MAX_EVENT_BYTES}-byte limit`)
        ? fail("message_too_large", detail)
        : fail("embedded_content", detail);
    }

    const schemaIssues = validateEvent(event);
    if (schemaIssues.length > 0) {
      return fail("invalid_request", "Event does not satisfy passport-event.schema.json.", schemaIssues);
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
      const response = await new TopicMessageSubmitTransaction()
        .setTopicId(body.topicId as string)
        .setMessage(message)
        .execute(client);
      const receipt = await response.getReceipt(client);

      return ok(
        {
          transactionId: response.transactionId.toString(),
          sequenceNumber: receipt.topicSequenceNumber?.toNumber(),
          bytes: Buffer.byteLength(message, "utf8"),
          payloadHash: event.payloadHash,
          network: operator.network,
        },
        201,
      );
    } finally {
      client.close();
    }
  });
}
