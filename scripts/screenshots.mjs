/**
 * Captures the screenshots used in the README.
 *
 *   yarn screenshots            # against an already-running app on :3000
 *
 * Deliberately shot against the bundled demo fixtures rather than a live
 * registry. Anyone can reproduce these exactly — `yarn install && yarn next:start`
 * and run this — and the fixtures contain the one thing a live testnet registry
 * usually will not: a passport that fails its checks. Screenshots of a system
 * where everything is green would sell the wrong idea of what it does.
 *
 * Re-run it whenever the UI changes. Stale screenshots are a documentation bug
 * that nothing else catches.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO_ROOT, "docs", "screenshots");
const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";

/** What to capture, and how much of it. */
// Viewport shots for the README — a full-page passport is ~3,600px tall and
// GitHub renders it at full width, which helps nobody. The `-full` variants are
// there for anyone who wants the whole page.
const SHOTS = [
  { file: "landing.png", url: "/", fullPage: false, wait: "h1" },
  { file: "verify-verified.png", url: "/verify/1", fullPage: false, wait: "[data-testid='timeline']" },
  { file: "verify-discrepancy.png", url: "/verify/2", fullPage: false, wait: "[data-testid='discrepancy-alert']" },
  {
    file: "documents.png",
    url: "/verify/2",
    fullPage: false,
    wait: "[data-testid='documents']",
    scrollTo: "[data-testid='documents']",
  },
  { file: "issuer.png", url: "/issuer", fullPage: false, wait: "h1" },
  { file: "verify-discrepancy-full.png", url: "/verify/2", fullPage: true, wait: "[data-testid='documents']" },
];

async function main() {
  mkdirSync(OUT, { recursive: true });

  // `channel: "chrome"` drives the system Chrome rather than a Playwright-managed
  // Chromium. Playwright 1.63 has no Chromium build for macOS 13, and the
  // harness's own browser gate already resolves to system Chrome for the same
  // reason. Override with PLAYWRIGHT_CHANNEL if your platform differs.
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";
  const browser = await chromium.launch(channel === "bundled" ? {} : { channel });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2, // README images are usually viewed at less than full size.
    colorScheme: "light",
  });

  try {
    for (const shot of SHOTS) {
      const page = await context.newPage();
      const errors = [];
      page.on("console", message => message.type() === "error" && errors.push(message.text()));

      await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle" });
      await page.waitForSelector(shot.wait, { timeout: 15_000 });
      if (shot.scrollTo) {
        await page.locator(shot.scrollTo).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      }

      await page.screenshot({ path: path.join(OUT, shot.file), fullPage: shot.fullPage });
      console.log(`  ${shot.file.padEnd(26)} ${shot.url}${errors.length ? `  (${errors.length} console error(s))` : ""}`);
      for (const error of errors) console.log(`      ${error}`);

      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`\nScreenshot capture failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Is the app running? `yarn next:start` in another terminal.");
  process.exitCode = 1;
});
