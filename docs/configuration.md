# Configuration

Nothing here is required to explore the template: with no configuration at all
it runs on bundled demo data. Everything below is for connecting it to a real
registry, and every variable listed is one the code actually reads.

Each workspace ships a `.env.example` with the same variables and comments.
`.env` and `.env.local` files are gitignored everywhere, excluded from Docker
images, and the harness fails the build if one is ever committed.

## What the bootstrap writes for you

`yarn passport:bootstrap` sets its own keys and leaves every other line alone,
so values you add by hand — `PINATA_JWT`, operator credentials — survive a
re-run:

| File | Keys it sets |
| --- | --- |
| `packages/nextjs/.env.local` | `NEXT_PUBLIC_PASSPORT_REGISTRY_ADDRESS`, `NEXT_PUBLIC_PASSPORT_TOKEN_ID`, `NEXT_PUBLIC_HEDERA_NETWORK`, `INDEX_API_URL` |
| `packages/indexer/.env.local` | `HEDERA_NETWORK`, `PASSPORT_REGISTRY_ADDRESS`, `INDEXER_TOPIC_IDS` (left empty on purpose) |

It never writes a key into the app. To register products from `/issuer`, add
operator credentials yourself — see the app table below.

## `packages/nextjs` — the app

| Variable | Side | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PASSPORT_REGISTRY_ADDRESS` | public | Deployed `PassportRegistry`. Written by the bootstrap. |
| `NEXT_PUBLIC_PASSPORT_TOKEN_ID` | public | HTS collection id. Without it the issuer page explains what to run instead of offering a form that would fail. |
| `NEXT_PUBLIC_HEDERA_NETWORK` | public | `testnet` (default), `mainnet` or `previewnet`. One setting for HashScan links, mirror node reads **and** the network the operator writes to. |
| `INDEX_API_URL` | server | Where the index API is; the bootstrap sets `http://localhost:3001`. Unset, the app serves bundled demo passports and says so on every page. Set but not answering, it says the indexer is not running rather than quietly showing the demo. |
| `PASSPORT_DATA_SOURCE` | server | `fixtures` forces demo mode even when an index is configured. |
| `HEDERA_OPERATOR_ID` | **server only** | Account that creates topics and submits events for the issuer pages. |
| `HEDERA_OPERATOR_PRIVATE_KEY` | **server only** | Its ECDSA key, hex. If you let the bootstrap derive the operator from your deployer, `yarn hardhat:account:reveal-pk` prints it. |
| `PINATA_JWT` | **server only** | Pins documents attached from the issuer page. Without it the page says documents cannot be attached; everything else works. |
| `PINATA_GATEWAY_URL` | server | Optional. Only names the provider in diagnostics; never changes a CID. |
| `ARWEAVE_JWK` | **server only** | Permanent storage instead of IPFS. Takes precedence over `PINATA_JWT`. Needs `yarn workspace @sh/nextjs add @irys/sdk`. |
| `ARWEAVE_NETWORK` | server | `devnet` (default, free, pruned after about sixty days) or `mainnet`. |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | public | Optional, from cloud.reown.com. Blank uses scaffold-hbar's shared development id. |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL`, `NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL` | public | JSON-RPC overrides. Blank uses Hashio. |
| `HEDERA_MIRROR_TESTNET_URL`, `HEDERA_MIRROR_MAINNET_URL` | server | Mirror node overrides for the account lookup route inherited from scaffold-hbar. Blank uses Hedera's public mirror nodes. |

**The operator variables are deliberately not `NEXT_PUBLIC_`.** A `NEXT_PUBLIC_`
prefix inlines a value into the browser bundle, so prefixing these would publish
the key that signs every HCS submission. `services/hederaClient.ts` imports
`server-only`, which turns an accidental import from a client component into a
build error rather than a leaked key at runtime. Leave them unset and the issuer
pages say so before anything is filled in; verifying passports never needs them.

`HEDERA_NETWORK` is still accepted as a server-side fallback for the operator's
network, but if it disagrees with `NEXT_PUBLIC_HEDERA_NETWORK` the write routes
refuse rather than showing one network and writing to another.

## `packages/indexer` — the indexer

It never takes a key. It only reads.

| Variable | Purpose |
| --- | --- |
| `HEDERA_NETWORK` | Which mirror node to read: `testnet` (default), `mainnet`, `previewnet`. |
| `PASSPORT_REGISTRY_ADDRESS` | Follow the registry: every product it registers is discovered from its `ProductRegistered` logs, including ones registered later. |
| `INDEXER_TOPIC_IDS` | Comma-separated topics to index instead. Takes precedence over discovery, so products registered later are **not** picked up while it is set. Leave it empty to follow the registry; the bootstrap does. |
| `MIRROR_NODE_URL` | Override the mirror node, for a private or local one. |
| `INDEXER_POLL_MS` | Poll interval, default `5000`. |
| `INDEX_DB_PATH` | SQLite file, default `./data/passport.db`. |
| `DATABASE_URL` | Use Postgres instead of SQLite. No code change. |
| `INDEXER_PORT` | Port for the read-only index API, default `3001`. |
| `IPFS_GATEWAY_URL` | Comma-separated trustless gateways, tried in order. Default `https://trustless-gateway.link,https://gateway.pinata.cloud`. None is trusted: each document is checked block by block against its CID, so extra gateways add availability, not trust. |
| `ARWEAVE_GATEWAY_URL` | Arweave gateway, default `https://arweave.net`. Arweave ids are not content hashes, so this one is trusted to return a transaction's data, and verdicts say so. |

## `packages/hardhat` — contracts and the bootstrap

| Variable | Purpose |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | Written by `yarn hardhat:account:generate` or `yarn hardhat:account:import`. Never fill this in by hand. |
| `HEDERA_RPC_URL` | JSON-RPC endpoint, defaults to Hashio testnet. |
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_PRIVATE_KEY` | Optional. Leave blank and the bootstrap derives the operator from the deployer key, resolving its `0.0.x` id through the mirror node. |
| `BOOTSTRAP_COLLECTION_FEE_HBAR` | HBAR forwarded to cover HTS token creation, default `20`. Raise it if `createCollection` reverts with `HtsCreateFailed(9)`. |
| `PINATA_JWT` | Optional. The bootstrap pins the HIP-412 metadata and a demo conformity declaration, attaches the declaration to the inspection event, and refuses any CID from Pinata that does not match the one it computed itself. Without it, metadata is served by the app and no document is attached. |
| `NEXT_PUBLIC_APP_URL` | Base URL baked into a serial's metadata pointer when there is no `PINATA_JWT`, default `http://localhost:3000`. |
| `BOOTSTRAP_NEW_PRODUCT` | What `yarn passport:new-product` sets. Use the command rather than setting this by hand: left in `.env`, it would start a new product on every run. |

The bootstrap refuses to run with the public Hardhat test account as deployer.
That is what `hardhat.config.ts` falls back to when no key has been decrypted,
it is funded on Hedera testnet by someone else's accident, and its private key
is in every Hardhat tutorial. Run `yarn passport:bootstrap`, which decrypts your
own key, rather than calling the script directly.

## `docker compose`

Compose reads a root `.env`; `.env.example` at the repository root lists every
key. Two of them are baked into the browser bundle at build time, so changing
them needs `docker compose up --build`:

| Variable | Why it needs a rebuild |
| --- | --- |
| `HEDERA_NETWORK` | Becomes `NEXT_PUBLIC_HEDERA_NETWORK`, which client components read. |
| `WALLET_CONNECT_PROJECT_ID` | Becomes `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`. |

Everything else is read at runtime. Server-rendered pages read even the
`NEXT_PUBLIC_` values at request time, so the registry address and token id take
effect on restart.

## Tooling

| Variable | Used by | Purpose |
| --- | --- | --- |
| `HEDERA_FORKING` | `yarn hardhat:test:forking` sets it | Runs the contract suite against the real HTS precompile on a forked network. |
| `BUILD_STANDALONE` | the app's `Dockerfile` sets it | Next's standalone output for the container image. Off otherwise, because it breaks `next start`. |
| `SCREENSHOT_BASE_URL` | `yarn screenshots` | App to capture, default `http://localhost:3000`. |
| `PLAYWRIGHT_CHANNEL` | `yarn screenshots` | Browser to drive, default the system `chrome`; `bundled` uses a Playwright-managed one. |
| `NEXT_PUBLIC_IGNORE_BUILD_ERROR` | `next build` | Inherited from scaffold-hbar: skips type and lint errors during a build. Leave it off. |
