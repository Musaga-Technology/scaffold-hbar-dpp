import { guard, ok } from "../_lib/responses";
import { listProducts } from "~~/lib/indexClient";
import { dataSource } from "~~/lib/indexClient";

/** Lists every passport in the index. Reads the index, never HCS. */
export async function GET() {
  return guard(async () => ok({ products: await listProducts(), source: dataSource() }));
}
