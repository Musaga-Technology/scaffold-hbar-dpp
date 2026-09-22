/**
 * The demo product the bootstrap registers.
 *
 * A battery, because the EU battery passport is the first Digital Product
 * Passport with a hard legal deadline (18 February 2027), which makes it the
 * clearest illustration of what this template is for. The fields match
 * `schemas/categories/battery.json`.
 */
import { canonicalize, sha256Hex } from "./events";

/** Category id in `schemas/categories/`. */
export const DEMO_CATEGORY = "battery";

/** Registration payload for the demo product. */
export const DEMO_PRODUCT = {
  name: "PowerCell 72 kWh EV Pack",
  manufacturer: "Northwind Cells",
  gtin: "09506000134352",
  batteryCategory: "EV",
  chemistry: "LFP",
  ratedCapacityKwh: 72,
  carbonFootprintKgPerKwh: 41.2,
  recycledContentPct: 18,
  manufacturedAt: "2026-07-14",
  manufacturingPlant: "Gdansk Plant 2",
  originCountry: "PL",
} as const;

/** Canonical hash of the demo product's registration payload. */
export function demoProductHash(): string {
  return sha256Hex(canonicalize({ category: DEMO_CATEGORY, ...DEMO_PRODUCT }));
}

/**
 * Builds the HIP-412 metadata bytes stored on the serial.
 *
 * Keyed by topic id, not serial. The metadata URL has to be chosen before the
 * mint that assigns the serial, so keying it by serial would mean guessing. The
 * topic is created first and identifies the product just as uniquely.
 *
 * Only a pointer goes on-chain — the registry caps this at 100 bytes. The full
 * HIP-412 document is served by the app at the referenced URL.
 *
 * @param baseUrl Public base URL of the app, without a trailing slash.
 * @param topicId Topic carrying the product's lifecycle log.
 * @returns The metadata URL.
 */
export function demoMetadataUrl(baseUrl: string, topicId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/passport/metadata/${topicId}`;
}

/** Demo lifecycle events submitted after registration, in order. */
export const DEMO_EVENTS = [
  {
    type: "product.shipped" as const,
    payload: {
      from: "Gdansk Plant 2",
      to: "Rotterdam DC",
      carrier: "Maersk",
      waybill: "MAEU-4471903",
    },
  },
  {
    type: "product.inspected" as const,
    payload: {
      result: "pass",
      inspector: "Example Test Laboratory",
      note: "State of health 100%, no cell imbalance.",
    },
  },
];
