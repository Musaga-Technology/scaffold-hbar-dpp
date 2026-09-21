import { fail, guard, ok, parseSerial } from "../../_lib/responses";
import { dataSource, getPassport } from "~~/lib/indexClient";

/** Returns one passport with its events and on-chain transfer history. */
export async function GET(_request: Request, { params }: { params: Promise<{ serial: string }> }) {
  return guard(async () => {
    const { serial: raw } = await params;
    const serial = parseSerial(raw);
    if (serial === undefined) {
      return fail("invalid_request", `"${raw}" is not a valid serial number.`);
    }

    const passport = await getPassport(serial);
    if (!passport) {
      return fail("not_found", `No passport indexed for serial ${serial}.`);
    }

    return ok({ ...passport, source: dataSource() });
  });
}
