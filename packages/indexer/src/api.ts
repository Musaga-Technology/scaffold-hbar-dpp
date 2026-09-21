/**
 * Read-only index API.
 *
 * `yarn indexer:dev` serves this so the app can read the index over HTTP instead
 * of opening the database file directly. That matters for more than tidiness:
 * the app deploys to serverless platforms with a read-only filesystem and no
 * native modules, so linking a SQLite driver into it would make the deployed app
 * unable to read its own index.
 *
 * Every route is a GET. This process never writes on behalf of a caller.
 */
import http from "node:http";
import type { IndexStore } from "./store/index.js";

/** Shapes the JSON the app consumes. Kept flat and boring on purpose. */
function passportPayload(view: NonNullable<Awaited<ReturnType<IndexStore["getPassport"]>>>) {
  return {
    product: view.product,
    events: view.events.map(event => ({
      ...event,
      payload: event.payloadJson ? JSON.parse(event.payloadJson) : null,
    })),
    transfers: view.transfers,
  };
}

/**
 * Routes one request against the index.
 *
 * @param store Index to read.
 * @param pathname Request path.
 * @returns Status and body.
 */
export async function handleRoute(store: IndexStore, pathname: string): Promise<{ status: number; body: unknown }> {
  if (pathname === "/health") {
    return { status: 200, body: { ok: true } };
  }

  if (pathname === "/stats" || pathname === "/api/passport/stats") {
    return { status: 200, body: await store.stats() };
  }

  if (pathname === "/products" || pathname === "/api/passport/products") {
    return { status: 200, body: { products: await store.listProducts() } };
  }

  const eventsMatch = pathname.match(/^(?:\/api\/passport)?\/products\/(\d+)\/events$/);
  if (eventsMatch) {
    const serial = Number(eventsMatch[1]);
    const product = await store.getProduct(serial);
    if (!product) return { status: 404, body: { error: "not_found", serial } };
    return { status: 200, body: { events: await store.listEvents(serial) } };
  }

  const productMatch = pathname.match(/^(?:\/api\/passport)?\/products\/(\d+)$/);
  if (productMatch) {
    const serial = Number(productMatch[1]);
    const view = await store.getPassport(serial);
    if (!view) return { status: 404, body: { error: "not_found", serial } };
    return { status: 200, body: passportPayload(view) };
  }

  return { status: 404, body: { error: "not_found", path: pathname } };
}

/**
 * Starts the read-only index API.
 *
 * @param store Index to serve.
 * @param port Port to listen on.
 * @returns The listening server.
 */
export function startApi(store: IndexStore, port: number): http.Server {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    void handleRoute(store, pathname)
      .then(({ status, body }) => {
        response.writeHead(status, {
          "content-type": "application/json",
          // The app may be served from a different origin in development.
          "access-control-allow-origin": "*",
        });
        response.end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: "internal", detail: error instanceof Error ? error.message : String(error) }),
        );
      });
  });

  server.listen(port);
  return server;
}
