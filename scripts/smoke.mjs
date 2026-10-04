/**
 * Browser smoke test for a freshly scaffolded, unconfigured app.
 *
 *   yarn smoke                      # against an app already running on :3000
 *   SMOKE_BASE_URL=http://host:port yarn smoke
 *
 * CI runs this against a project scaffolded through the real create-scaffold-hbar
 * CLI, with no .env, so it checks what a developer actually gets on first run.
 * It loads each public and wallet page in a real browser and fails if:
 *
 *   - a page does not answer 200, or does not show the content it exists for;
 *   - anything is logged to the browser console as an error — the harness gate
 *     fails on the same thing, and a third-party price API blocking CORS once
 *     made that gate pass or fail at random;
 *   - the browser requests HCS topic messages itself. Invariant 2: reads come
 *     from the index API, never from HCS. Until this existed, only a person
 *     watching devtools could check it.
 *
 * Expectations are for demo mode — no INDEX_API_URL — which is what an
 * unconfigured scaffold serves.
 */
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** What each page must show, and how to recognise it. */
const PAGES = [
  {
    path: "/",
    text: ["Every product, with a history you can check", "This is sample data", "All 3 passports"],
  },
  {
    path: "/verify/1",
    text: ["PowerCell 72 kWh EV Pack", "Verified"],
    testIds: ["timeline", "documents"],
  },
  {
    // The demo passport that fails its checks — the template's whole argument.
    path: "/verify/2",
    text: ["Coastal Parka, recycled shell", "does not match its attestation"],
    testIds: ["discrepancy-alert", "document-alert"],
  },
  {
    // The bundled snapshot of a real testnet passport: real ids, links that resolve.
    path: "/verify/3",
    text: ["Harbour Merino Crew, recycled blend", "A real passport on Hedera testnet", "Verified"],
    testIds: ["snapshot-banner", "timeline", "documents"],
  },
  {
    // No registry configured, so the page must say what to run, not offer a form.
    path: "/issuer",
    text: ["Issue a passport", "No registry configured", "yarn passport:bootstrap"],
    testIds: ["not-configured"],
  },
  { path: "/my-passports", text: ["My passports"] },
  {
    // GS1 Digital Link: what a QR code on a product resolves to.
    path: "/01/09506000134352/21/1",
    text: ["PowerCell 72 kWh EV Pack"],
    finalPath: "/verify/1",
  },
];

/** A browser request that reads HCS directly, which invariant 2 forbids. */
const HCS_READ = /\/api\/v1\/topics\/[^/]+\/messages/;

export async function checkPage(context, spec) {
  const page = await context.newPage();
  const failures = [];
  const consoleErrors = [];
  const hcsReads = [];

  page.on("console", message => message.type() === "error" && consoleErrors.push(message.text()));
  page.on("pageerror", error => consoleErrors.push(String(error)));
  page.on("request", request => HCS_READ.test(request.url()) && hcsReads.push(request.url()));

  const response = await page.goto(`${BASE}${spec.path}`, { waitUntil: "load", timeout: 120_000 });
  // Client components and their data settle after load.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  if (!response || response.status() !== 200) failures.push(`status ${response?.status() ?? "none"}`);

  if (spec.finalPath && new URL(page.url()).pathname !== spec.finalPath) {
    failures.push(`ended at ${new URL(page.url()).pathname}, expected ${spec.finalPath}`);
  }

  const body = await page.innerText("body");
  for (const text of spec.text ?? []) {
    if (!body.includes(text)) failures.push(`missing text "${text}"`);
  }
  for (const id of spec.testIds ?? []) {
    if ((await page.locator(`[data-testid="${id}"]`).count()) === 0) failures.push(`missing [data-testid="${id}"]`);
  }

  for (const error of consoleErrors) failures.push(`console error: ${error.slice(0, 200)}`);
  for (const url of hcsReads) failures.push(`browser read HCS directly: ${url}`);

  await page.close();
  return failures;
}

async function checkApi() {
  const failures = [];
  const response = await fetch(`${BASE}/api/passport/products`);
  if (response.status !== 200) return [`status ${response.status}`];
  const body = await response.json();
  const products = Array.isArray(body) ? body : body.products;
  if (!Array.isArray(products) || products.length !== 3) {
    failures.push(`expected the 3 bundled products, got ${JSON.stringify(body).slice(0, 120)}`);
  }
  return failures;
}

async function main() {
  // System Chrome locally, as `yarn screenshots` does; CI installs Playwright's
  // own Chromium and sets PLAYWRIGHT_CHANNEL=bundled.
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";
  const browser = await chromium.launch(channel === "bundled" ? {} : { channel });
  const context = await browser.newContext();

  let failed = 0;
  try {
    for (const spec of PAGES) {
      const failures = await checkPage(context, spec);
      report(spec.path, failures);
      failed += failures.length ? 1 : 0;
    }
    const apiFailures = await checkApi();
    report("/api/passport/products", apiFailures);
    failed += apiFailures.length ? 1 : 0;
  } finally {
    await browser.close();
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed against ${BASE}.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${PAGES.length + 1} checks passed against ${BASE}.`);
  }
}

function report(label, failures) {
  console.log(`${failures.length ? "FAIL" : "ok  "}  ${label}`);
  for (const failure of failures) console.log(`        ${failure}`);
}

// Run only when executed, so the checks can be imported and tested on their own.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`\nSmoke test could not run: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Is the app running? `yarn next:serve` after `yarn next:build`, or `yarn next:start`.");
    process.exitCode = 1;
  });
}
