# Configuration

Nothing here is required to explore the template. Every variable below is for
connecting it to a real registry.

### `packages/nextjs`

| Variable | Side | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_HEDERA_NETWORK` | public | `testnet` (default), `mainnet` or `previewnet`. Chooses the HashScan and mirror node endpoints. |
| `NEXT_PUBLIC_PASSPORT_REGISTRY_ADDRESS` | public | Deployed `PassportRegistry`. Written by `yarn passport:bootstrap`. |
| `NEXT_PUBLIC_PASSPORT_TOKEN_ID` | public | HTS collection id. Without it the issuer page explains what to run instead of offering a form that would fail. |
| `INDEX_API_URL` | server | Where to read the index. Unset, the app serves bundled demo fixtures and says so. |
| `PASSPORT_DATA_SOURCE` | server | Set to `fixtures` to force demo mode even when an index is configured. |
| `HEDERA_OPERATOR_ID` | **server only** | Operator that creates topics and submits events. |
| `HEDERA_OPERATOR_PRIVATE_KEY` | **server only** | Its ECDSA key. |

**The operator variables are deliberately not `NEXT_PUBLIC_`.** A `NEXT_PUBLIC_`
prefix inlines a value into the browser bundle, so prefixing these would publish
the key that signs every HCS submission. `services/hederaClient.ts` imports
`server-only`, which turns an accidental import from a client component into a
build error rather than a leaked key at runtime. Leave them unset and the two
write routes return `503` with setup instructions; everything else keeps working.

### `packages/indexer`

| Variable | Purpose |
| --- | --- |
| `HEDERA_NETWORK` | Which mirror node to read. |
| `INDEXER_TOPIC_IDS` | Comma-separated topics to index. Takes precedence over discovery, so products registered later are **not** picked up while it is set. Leave it empty to follow the registry; the bootstrap does. |
| `PASSPORT_REGISTRY_ADDRESS` | Discover topics from the registry's `ProductRegistered` logs instead. |
| `INDEXER_POLL_MS` | Poll interval, default `5000`. |
| `INDEX_DB_PATH` | SQLite file, default `./data/passport.db`. |
| `DATABASE_URL` | Use Postgres instead of SQLite. |
| `INDEXER_PORT` | Port for the read-only index API, default `3001`. |

The indexer never takes a key. It only reads.

### `packages/hardhat`

| Variable | Purpose |
| --- | --- |
| `HEDERA_RPC_URL` | JSON-RPC endpoint, defaults to Hashio testnet. |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | Written by `yarn hardhat:account:generate` or `yarn hardhat:account:import`. Never fill this in by hand. |
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_PRIVATE_KEY` | Optional. Leave blank and the bootstrap derives the operator from the deployer key, resolving its `0.0.x` id through the mirror node. |
| `BOOTSTRAP_COLLECTION_FEE_HBAR` | HBAR forwarded to cover HTS token creation, default `20`. Raise it if `createCollection` reverts. |
| `PINATA_JWT` | Optional. Pins the HIP-412 metadata and a demo conformity declaration, attached to the inspection event, and refuses any CID from Pinata that does not match the one computed locally. Without it, metadata is served by the app and no document is attached. |
| `BOOTSTRAP_NEW_PRODUCT` | What `yarn passport:new-product` sets: register another demo product on the same registry and collection. Earlier products are kept in `passport.state.json`; the indexer finds every product through the registry. A run that failed partway finishes that product before starting another. Use the command rather than setting this by hand. |

The bootstrap only sets its own keys in `packages/nextjs/.env.local` and
`packages/indexer/.env.local`. Anything else you put there, such as
`PINATA_JWT`, survives a re-run.

Every workspace ships a `.env.example`. `.env` files are gitignored, and the
harness fails the build if one is ever committed.
