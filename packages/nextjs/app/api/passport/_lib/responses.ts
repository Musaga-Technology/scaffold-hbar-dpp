/**
 * Typed JSON responses shared by every passport route.
 *
 * Routes never leak a driver exception or a stack trace to a caller: every
 * failure becomes a stable `{ error, message }` shape with a useful status, so
 * the UI can distinguish "not configured yet" from "not found" from "broken".
 */
import { NextResponse } from "next/server";

/** Error codes a caller can branch on. */
export type ErrorCode =
  | "not_found"
  | "invalid_request"
  | "operator_unavailable"
  | "message_too_large"
  | "embedded_content"
  | "index_unavailable"
  | "storage_unavailable"
  | "not_permitted"
  | "internal";

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  issues?: Array<{ field: string; message: string }>;
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  not_found: 404,
  invalid_request: 400,
  operator_unavailable: 503,
  message_too_large: 413,
  embedded_content: 422,
  index_unavailable: 503,
  storage_unavailable: 503,
  not_permitted: 403,
  internal: 500,
};

/** Builds a typed error response. */
export function fail(code: ErrorCode, message: string, issues?: ErrorBody["issues"]): NextResponse<ErrorBody> {
  return NextResponse.json(
    { error: code, message, ...(issues && issues.length > 0 ? { issues } : {}) },
    { status: STATUS_BY_CODE[code] },
  );
}

/** Builds a success response. */
export function ok<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status });
}

/**
 * Parses a `[serial]` route segment.
 *
 * @param raw Raw segment.
 * @returns The serial, or undefined when it is not a positive integer.
 */
export function parseSerial(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const serial = Number(raw);
  return Number.isInteger(serial) && serial >= 1 ? serial : undefined;
}

/**
 * Wraps a handler so an unexpected throw becomes a typed 500 rather than an
 * HTML error page.
 */
export async function guard<T>(handler: () => Promise<NextResponse<T | ErrorBody>>) {
  try {
    return await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // An unreachable index is the common case and is not the app's fault.
    if (message.includes("Index API")) {
      return fail("index_unavailable", `${message}. Is \`yarn indexer:dev\` running?`);
    }
    return fail("internal", message);
  }
}
