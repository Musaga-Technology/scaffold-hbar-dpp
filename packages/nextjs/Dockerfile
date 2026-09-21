# App image.
#
# Built on Next's standalone output, so the runtime layer carries a traced
# dependency set rather than a full node_modules. The app serves passport pages
# and the /api/passport routes; it holds no database and reads the index over
# HTTP, which is what lets it scale to more than one replica.
FROM node:20-slim AS deps
WORKDIR /repo

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY .yarn/plugins ./.yarn/plugins
COPY packages/nextjs/package.json packages/nextjs/
COPY packages/indexer/package.json packages/indexer/
COPY packages/hardhat/package.json packages/hardhat/

# Only the app and the indexer (for the shared event model) are needed. The
# hardhat workspace carries a very large toolchain this image never runs.
RUN corepack enable && yarn workspaces focus @sh/nextjs @sh/indexer

FROM deps AS builder
WORKDIR /repo
COPY . .

# The app imports @sh/indexer/events for the shared event model, so the indexer
# workspace has to be present at build time even though it is a separate image.
RUN corepack enable && yarn workspace @sh/nextjs build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Standalone output is rooted at the monorepo root, so the server lands at
# packages/nextjs/server.js with node_modules traced alongside it.
COPY --from=builder --chown=node:node /repo/packages/nextjs/.next/standalone ./
COPY --from=builder --chown=node:node /repo/packages/nextjs/.next/static ./packages/nextjs/.next/static
COPY --from=builder --chown=node:node /repo/packages/nextjs/public ./packages/nextjs/public

USER node
EXPOSE 3000

CMD ["node", "packages/nextjs/server.js"]
