/**
 * Event construction and validation for the app's server routes.
 *
 * The event model itself is not redefined here. It is imported from
 * `@sh/indexer/events`, which is the reference implementation — one
 * canonicalisation, one hash function, pinned by `schemas/event-vectors.json`.
 * This module adds only what the app needs on top: JSON Schema validation of
 * caller-supplied input, before anything is signed or submitted.
 */
import eventSchema from "../../../schemas/passport-event.schema.json";
import addFormats from "ajv-formats";
// `ajv` defaults to draft-07. passport-event.schema.json declares draft
// 2020-12, and the default export refuses it at compile time with an error
// about an unknown $schema — which only surfaces once a payload gets far
// enough to be schema-checked at all.
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

export {
  BUILT_IN_EVENT_TYPES,
  EVENT_VERSION,
  MAX_EVENT_BYTES,
  assertNoEmbeddedContent,
  buildEvent,
  canonicalize,
  decodeEvent,
  hashPayload,
  isBuiltInEventType,
  isCustomEventType,
  isKnownEventType,
  sha256Hex,
  type BuildEventInput,
  type EventType,
  type PassportEvent,
} from "@sh/indexer/events";

/** A validation failure, shaped for a typed JSON error response. */
export interface ValidationIssue {
  field: string;
  message: string;
}

let cachedValidator: ValidateFunction | undefined;

/** Compiles the event schema once per process. */
function validator(): ValidateFunction {
  if (!cachedValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    cachedValidator = ajv.compile(eventSchema);
  }
  return cachedValidator;
}

function toIssue(error: ErrorObject): ValidationIssue {
  return {
    field:
      error.instancePath === ""
        ? ((error.params as { missingProperty?: string }).missingProperty ?? "(root)")
        : error.instancePath.replace(/^\//, ""),
    message: error.message ?? "is invalid",
  };
}

/**
 * Validates a fully-built event against `schemas/passport-event.schema.json`.
 *
 * The schema is the contract between the app, the indexer and anyone else
 * reading the topic, so it is enforced at the boundary rather than trusted.
 *
 * @param event Candidate event.
 * @returns An empty array when valid, otherwise one issue per violation.
 */
export function validateEvent(event: unknown): ValidationIssue[] {
  const validate = validator();
  if (validate(event)) return [];
  return (validate.errors ?? []).map(toIssue);
}

/** Input a caller may supply when logging an event. Everything else is derived. */
export interface LogEventRequest {
  type: string;
  serial: number;
  tokenId: string;
  actor: string;
  payload: Record<string, unknown>;
  ref?: string;
  prev?: number;
}

/**
 * Checks caller-supplied input before any event is built.
 *
 * Validating the assembled event alone is not enough: `payloadHash` and `v` are
 * computed here, so a caller could never fail those checks, and the fields they
 * *do* control would go unchecked.
 *
 * @param body Parsed request body.
 * @returns Issues, empty when acceptable.
 */
export function validateLogEventRequest(body: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return [{ field: "(root)", message: "must be a JSON object" }];
  }

  const request = body as Partial<LogEventRequest>;

  if (typeof request.type !== "string") {
    issues.push({ field: "type", message: "must be a string" });
  }
  if (!Number.isInteger(request.serial) || (request.serial as number) < 1) {
    issues.push({ field: "serial", message: "must be a positive integer" });
  }
  if (typeof request.tokenId !== "string" || !/^\d+\.\d+\.\d+$/.test(request.tokenId)) {
    issues.push({ field: "tokenId", message: "must look like 0.0.x" });
  }
  if (typeof request.actor !== "string" || request.actor.length === 0) {
    issues.push({ field: "actor", message: "must be a non-empty string" });
  }
  if (typeof request.payload !== "object" || request.payload === null || Array.isArray(request.payload)) {
    issues.push({ field: "payload", message: "must be an object" });
  }
  if (request.ref !== undefined && typeof request.ref !== "string") {
    issues.push({ field: "ref", message: "must be a string when present" });
  }
  if (request.prev !== undefined && (!Number.isInteger(request.prev) || (request.prev as number) < 1)) {
    issues.push({ field: "prev", message: "must be a positive integer when present" });
  }

  return issues;
}
