/**
 * Passport event model — the reference implementation.
 *
 * This subpath is dependency-free on purpose: the Next.js app imports it as
 * `@sh/indexer/events`, and pulling the indexer's native SQLite driver into a
 * serverless bundle would break the app's deploy. Keep it that way.
 */
export { canonicalize, hashPayload, sha256Hex } from "./canonical.js";
export { assertNoEmbeddedContent, buildEvent, type BuildEventInput } from "./build.js";
export { decodeBase64Event, decodeEvent } from "./decode.js";
export { reassemble, type AssembledMessage, type ChunkInfo, type MirrorTopicMessage } from "./reassemble.js";
export {
  BUILT_IN_EVENT_TYPES,
  EVENT_VERSION,
  MAX_EVENT_BYTES,
  isBuiltInEventType,
  isCustomEventType,
  isKnownEventType,
  type BuiltInEventType,
  type DecodeResult,
  type DecodedEvent,
  type EventType,
  type MalformedEvent,
  type MalformedReason,
  type PassportEvent,
} from "./types.js";
