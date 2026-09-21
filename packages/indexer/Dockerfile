# Indexer image.
#
# The indexer is the half of this template a serverless host cannot run: a
# long-lived poller with a database. It is a plain container so it runs anywhere
# — Docker Compose, Fly, Railway, Render, ECS, a systemd unit.
#
# It never needs an operator key. It only reads the mirror node.
#
# Four stages so the runtime layer carries neither the TypeScript toolchain nor
# yarn itself: compile in one, resolve production dependencies in another, and
# copy only those two results into a clean base.

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
RUN corepack enable && yarn workspaces focus @sh/indexer

FROM deps AS builder
WORKDIR /repo
COPY packages/indexer ./packages/indexer
COPY schemas ./schemas
RUN corepack enable && yarn workspace @sh/indexer build

# Resolve the same dependency set again, without dev dependencies. TypeScript,
# drizzle-kit, esbuild, eslint and prettier are all build-time only and together
# are most of the dependency weight.
FROM deps AS prod-deps
WORKDIR /repo
RUN corepack enable && yarn workspaces focus @sh/indexer --production

FROM node:20-slim AS runner
WORKDIR /repo/packages/indexer
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Note what is NOT copied: no .yarn directory (that is a package cache, and this
# image never runs yarn), no TypeScript sources, no test output.
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/packages/indexer/node_modules /repo/packages/indexer/node_modules
COPY --from=builder /repo/packages/indexer/dist/src /repo/packages/indexer/dist/src
COPY --from=builder /repo/packages/indexer/package.json /repo/packages/indexer/package.json
COPY schemas /repo/schemas

# The index lives on a volume so a container restart does not discard it. It is
# still fully rebuildable from the mirror node with `indexer:replay`.
RUN mkdir -p /repo/packages/indexer/data \
    && chown -R node:node /repo/packages/indexer/data

USER node
EXPOSE 3001

CMD ["node", "dist/src/index.js", "dev"]
