import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Standalone output only when building the container image. It keeps that
  // image small, but it is incompatible with `next start` — which is what
  // `yarn next:serve` runs — and Next warns about exactly that. Making it
  // conditional means the ordinary local path stays clean and Docker still
  // gets its traced, self-contained server.
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // @sh/indexer/events ships TypeScript source and is the reference
  // implementation of the HCS event model. Only that subpath is ever imported;
  // it is dependency-free, so the indexer's native SQLite driver never reaches
  // the app bundle.
  transpilePackages: ["@sh/indexer"],
  reactStrictMode: true,
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: (config, { dev }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };

    // @sh/indexer is ESM TypeScript source, so its internal imports carry the
    // explicit `.js` specifiers Node's ESM resolver requires. Webpack has to be
    // told those map onto the `.ts` files on disk.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // Suppress "Critical dependency" warnings from @coinbase/cdp-sdk and related packages
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /node_modules\/@coinbase\/cdp-sdk/,
        message: /Critical dependency/,
      },
      {
        module: /node_modules\/ox/,
        message: /Critical dependency/,
      },
    ];

    if (dev) {
      config.watchOptions = {
        followSymlinks: true,
      };
      config.snapshot = { ...(config.snapshot as object), managedPaths: [] };
    }
    return config;
  },
};

module.exports = nextConfig;
