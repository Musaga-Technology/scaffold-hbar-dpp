import { fail, guard, ok, parseSerial } from "../../../_lib/responses";
import { listEvents } from "~~/lib/indexClient";

/** Returns one passport's lifecycle events, in consensus order. */
export async function GET(_request: Request, { params }: { params: Promise<{ serial: string }> }) {
  return guard(async () => {
    const { serial: raw } = await params;
    const serial = parseSerial(raw);
    if (serial === undefined) {
      return fail("invalid_request", `"${raw}" is not a valid serial number.`);
    }
    return ok({ events: await listEvents(serial) });
  });
}
