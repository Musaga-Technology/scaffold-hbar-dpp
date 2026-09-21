# Indexer image.
#
# The indexer is the half of this template a serverless host cannot run: a
# long-lived poller with a database. It is a plain container so it runs anywhere
# — Docker Compose, Fly, Railway, Render, ECS, a systemd unit.
#
# It never needs an operator key. It only reads the mirror node.
FROM node:20-slim AS deps
WORKDIR /repo

# better-sqlite3 is native. Prebuilds cover common platforms, but the toolchain
# has to be here for the cases they do not, or install fails on arm64 hosts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY .yarn/plugins ./.yarn/plugins
COPY packages/indexer/package.json packages/indexer/
COPY packages/hardhat/package.json packages/hardhat/
COPY packages/nextjs/package.json packages/nextjs/

# Only the indexer workspace is needed; the app and contracts are separate
# images, and installing their trees here would add tens of minutes for nothing.
# Dev dependencies are kept because the runtime uses tsx to run TypeScript.
RUN corepack enable \
    && yarn workspaces focus @sh/indexer

FROM node:20-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/indexer/node_modules ./packages/indexer/node_modules
COPY --from=deps /repo/.yarn ./.yarn
COPY --from=deps /repo/.yarnrc.yml ./.yarnrc.yml
COPY --from=deps /repo/package.json ./package.json
COPY packages/indexer ./packages/indexer
COPY schemas ./schemas

# The index lives on a volume so a container restart does not discard it. It is
# still fully rebuildable from the mirror node with `indexer:replay`.
RUN mkdir -p /repo/packages/indexer/data \
    && chown -R node:node /repo/packages/indexer/data

USER node
WORKDIR /repo/packages/indexer
EXPOSE 3001

# tsx runs the TypeScript sources directly. The indexer is small and its startup
# cost is irrelevant next to a poll interval measured in seconds.
CMD ["node_modules/.bin/tsx", "src/index.ts", "dev"]
