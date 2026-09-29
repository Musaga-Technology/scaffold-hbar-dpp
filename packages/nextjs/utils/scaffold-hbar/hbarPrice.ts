export const HBAR_PRICE_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache
/**
 * Hedera's own HBAR/USD exchange rate, from the mainnet mirror node.
 *
 * This was CoinGecko. From a browser it intermittently answers 403 with no CORS
 * header, and the browser logs that as a console error that no try/catch can
 * suppress — on every wallet page, since the footer shows the price. The
 * harness fails its browser gate on console errors, so whether it passed came
 * down to whether CoinGecko was blocking at that moment.
 *
 * The mirror node needs no key, allows any origin, and publishes the rate the
 * network itself uses to price fees. Mainnet's rather than testnet's, whichever
 * network the app targets: testnet's rate file is not kept current.
 */
export const HBAR_PRICE_URL = "https://mainnet.mirrornode.hedera.com/api/v1/network/exchangerate";

type HbarPriceCache = {
  price: number;
  timestamp: number;
};

let cache: HbarPriceCache | null = null;

export async function fetchHbarPrice(): Promise<number> {
  const now = Date.now();

  // Return cached price if still valid
  if (cache && now - cache.timestamp < HBAR_PRICE_CACHE_DURATION_MS) {
    return cache.price;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(HBAR_PRICE_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const rate = data?.current_rate;
    // cent_equivalent US cents buy hbar_equivalent HBAR.
    const price = rate?.hbar_equivalent > 0 ? rate.cent_equivalent / rate.hbar_equivalent / 100 : 0;

    if (price > 0) {
      cache = { price, timestamp: now };
    }

    return price || cache?.price || 0;
  } catch {
    // Silently fail and return cached price or 0
    // This prevents console spam from intermittent network issues
    return cache?.price ?? 0;
  }
}
