import { guard, ok } from "../_lib/responses";
import { dataSource, getStats } from "~~/lib/indexClient";

/** Registry-wide counts for the landing page. */
export async function GET() {
  return guard(async () => ok({ ...(await getStats()), source: dataSource() }));
}
