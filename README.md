# product-passport — Provenance & Digital Product Passports on Hedera

A scaffold-hbar template that gives any team a working Digital Product Passport (DPP) system on Hedera in one command.

Every physical product — a battery, a garment, a pallet of coffee, a pharmaceutical lot — gets an HTS non-fungible token as its identity, an HCS topic as its ordered lifecycle log, and a public page anyone can verify by scanning a QR code.

```bash
npm create scaffold-hbar@latest my-passports -- --template <your-org>/scaffold-hbar-product-passport
```

> **Build status.** This template is being built in increments. Increment 01 (workspace shape, `PassportRegistry`, bootstrap) is complete; the HCS event layer and indexer (02), the UI (03) and the airdrop/claim flow (04) are in progress. Sections below marked _(increment NN)_ describe behaviour that is designed and specified in `.harness/prds/` but not yet implemented. This notice is removed when all four increments land.

## Why this template

- **A real deadline.** EU battery passports are mandatory from 18 February 2027 under Regulation 2023/1542. ESPR extends Digital Product Passports to steel, textiles, furniture and electronics through 2030. Every brand selling into the EU needs a reference implementation.
- **The canonical HCS pattern, end to end.** Hedera's own guidance is that HCS records what happened so it can be trusted later, and a database answers queries. This template implements exactly that — including the "write ten state transitions, rebuild state from the mirror node, compare" check, as a one-line script.
- **Hedera-only capabilities.** Consensus timestamps, native NFT compliance keys, HIP-904 airdrops, the mirror node as the indexing source, and HTS-from-Solidity through the system contract at `0x167`.

## Before you start

| Path | What you need installed |
| --- | --- |
| **Explore it offline** | Node ≥ 20.18.3. Nothing else — corepack ships with Node and provides Yarn 3.2.3. |
| **Run it live on Hedera testnet** | The same, plus a funded ECDSA account from [portal.hedera.com](https://portal.hedera.com). That is an account, not software. |
| **Run the whole stack in containers** | Docker. No Node, no Yarn, no Solidity toolchain on your machine — the images install everything inside themselves. |

Be aware of the install cost before you start the first one:

```
packages/nextjs/node_modules    1.7 GB    Next.js, RainbowKit, wagmi, viem
packages/hardhat/node_modules   707 MB    Solidity toolchain, Hardhat, typechain
packages/indexer/node_modules   181 MB    Drizzle, better-sqlite3, pg
```

About 2.6 GB and, on a cold Yarn cache, tens of minutes. Most of that is inherited
from scaffold-hbar rather than added here, and almost all of it is toolchain: if
you only want to *run* the template, `docker compose up` needs Docker alone. The
Solidity toolchain is only worth installing if you intend to change the contract.

**ECDSA, not ED25519.** Every EVM flow in this template — the registry contract,
wallet-signed custody transfers — needs an ECDSA account.
`yarn hardhat:account:generate` creates one.

## From zero to a live passport in 5 commands

```bash
yarn install
yarn hardhat:account:generate     # creates an ECDSA deployer key
# fund it at https://portal.hedera.com/faucet  (~25 HBAR)
yarn passport:bootstrap           # deploy, create collection + topic, register a demo product
yarn indexer:dev                  # index the mirror node and reconcile custody
yarn next:start                   # then open http://localhost:3000/verify/1
```

`yarn passport:bootstrap` is idempotent. If it fails halfway — an unfunded account, a fee set too low — fix the cause and run it again; finished steps are skipped and not paid for twice.

### Or explore it first, with no account at all

```bash
yarn install
yarn next:start                   # http://localhost:3000/verify/1
```

With no `.env` and no network, the app serves bundled demo fixtures so the whole UI is explorable offline, with a banner saying the data is demo data _(increment 03)_.

## Why HCS plus an index, and not HCS as a database

An HCS topic is an append-only, consensus-ordered log. It is excellent at proving that something was claimed at a particular moment, and bad at answering "show me every battery from plant 2 with a failed inspection". Submitting a message also costs about $0.0008, so a topic is not a place to put documents.

So this template splits the job:

| Concern | Where it lives | Why |
| --- | --- | --- |
| What happened, in what order | HCS topic, one per product | Consensus timestamps are the proof |
| Who holds the product now | HTS NFT custody | The network's own answer, not a claim |
| Answering queries | Indexer database | Rebuildable from the mirror node at any time |
| Large content | Off-chain, hash + URL only | HCS messages are capped at 1024 bytes here |

The two truth sources are deliberately reconciled rather than merged. For every custody claim on HCS, the indexer checks the NFT's real transfer history on the mirror node. A claim with no matching transfer is surfaced as a **discrepancy**, never hidden. `yarn indexer:verify` replays the whole log into a temporary index and diffs it against the live one _(increment 02)_.

## Architecture

```
packages/
  hardhat/     PassportRegistry.sol (HTS via 0x167), MockHTS tests, bootstrap + status scripts
  nextjs/      App Router UI, /api/passport/* server routes, schema-driven forms, QR
  indexer/     mirror node poller -> event decoder -> SQLite/Postgres -> reconciliation
schemas/       passport-event.schema.json + one file per product category
.harness/      incremental PRDs, validators and the acceptance contract
```

Reads never touch HCS or the contract directly — they hit the index. That is an architectural rule, not a preference, and it is checked by assertion C8 of `.harness/acceptance-contract.json`.

## The registry contract

`PassportRegistry` mints one HTS serial per product through the system contract and binds it to that product's topic.

| Function | Who | What it does |
| --- | --- | --- |
| `createCollection(name, symbol)` | owner | Creates the NFT collection. Registry is treasury and sole supply key holder. Payable — forwards `msg.value` as the token creation fee. |
| `registerProduct(metadata, productHash, topicId)` | owner or allow-listed issuer | Mints one serial, stores the topic binding, emits `ProductRegistered` |
| `transferCustody(serial, to)` | current holder | Moves the NFT, emits `CustodyTransferred` |
| `airdropPassport(serial, to)` | owner or product issuer | Sends a treasury-held passport to a consumer |
| `setIssuer(account, allowed)` | owner | Grants permission to register products |
| `setEventLogger(serial, account, allowed)` | owner or product issuer | Allow-list for logging lifecycle events |

**Deliberately no freeze, pause or wipe keys.** A passport must stay transferable for the life of the product and must not be clawed back. Regulated categories that need those keys should add them in `_defaultTokenKeys` and document the consequence.

**On-chain metadata is a pointer, never a document.** `registerProduct` caps metadata at 100 bytes — enough for a URL to the HIP-412 JSON, not enough to smuggle a PDF onto the ledger.

## Event model

Every lifecycle event is a compact JSON message on the product's topic, validated against `schemas/passport-event.schema.json` and capped at 1024 bytes:

```json
{
  "v": 1,
  "type": "product.inspected",
  "serial": 1,
  "tokenId": "0.0.5005",
  "ts": "2026-09-21T10:00:00.000Z",
  "actor": "0xabc…",
  "payloadHash": "9f86d0…",
  "payload": { "result": "pass", "inspector": "TUV Rheinland" }
}
```

`payloadHash` is the sha256 of the canonical JSON of `payload` (keys sorted, no whitespace), so the indexer can prove a payload was not edited after the fact. Consensus timestamp is authoritative; `ts` is only what the client claimed.

Attachments — certificates, photos, test reports — are referenced by hash and URL. Nothing large goes on HCS.

## Commands

| Command | What it does |
| --- | --- |
| `yarn install` | Install all three workspaces |
| `yarn passport:bootstrap` | Zero to a live passport on Hedera testnet |
| `yarn passport:status` | Check every deployed entity against the mirror node |
| `yarn indexer:dev` | Poll the mirror node, reconcile custody, serve the index API |
| `yarn indexer:replay` | Drop the index and rebuild it from sequence 1 |
| `yarn indexer:verify` | Replay into a temp index and diff it against the live one |
| `yarn indexer:test` | Indexer unit tests |
| `yarn next:start` | Run the app |
| `yarn next:build` | Production build |
| `yarn hardhat:test` | Contract unit tests against MockHTS |
| `yarn hardhat:test:forking` | Optional tests against a Hedera fork |
| `yarn lint` / `yarn format` | All three workspaces |

## Running it somewhere other than your laptop

This template is two processes, not one. The app serves pages; the indexer is a
long-running poller with a database. Any hosting story that only covers the app
covers half the system.

### Self-host — the whole thing, one command

```bash
docker compose up
```

Brings up the app, the indexer and Postgres together, on any machine that runs
containers: your own box, a VM, on-prem, or any cloud. Nothing here is tied to a
particular vendor. Set `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_PRIVATE_KEY` in
the environment to enable the routes that create topics and submit events; leave
them unset and the app still serves the demo passport _(increment 04)_.

The indexer is a plain container, so Fly.io, Railway, Render, ECS or a systemd
unit all work the same way — see `packages/indexer/Dockerfile` _(increment 04)_.

### One-click preview — the public page only

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

Useful for putting the public verify page in front of someone in about thirty
seconds: it renders from bundled fixtures, so a first deploy needs no
environment at all and cannot be broken by missing configuration.

**This deploys the app, not the system.** Serverless platforms cannot run the
indexer — it needs a persistent process and a database — so a passport deployed
this way shows demo data until you point `INDEX_API_URL` at an indexer hosted
somewhere that can run one. The same applies to any platform of this shape; it is
not a Vercel-specific limitation.

Deployment is always an explicit command after funding — never a side effect of
scaffolding or CI.

## Environment variables

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
| `INDEXER_TOPIC_IDS` | Comma-separated topics to index. Takes precedence over discovery. |
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
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | Written by `yarn hardhat:account:generate`. Never fill this in by hand. |
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_PRIVATE_KEY` | Optional. Leave blank and the bootstrap derives the operator from the deployer key, resolving its `0.0.x` id through the mirror node. |
| `BOOTSTRAP_COLLECTION_FEE_HBAR` | HBAR forwarded to cover HTS token creation, default `20`. Raise it if `createCollection` reverts. |

Each workspace ships a `.env.example`. `.env` files are gitignored everywhere,
and the harness fails the build if one is ever committed.

## Extending it

- **A new product category** — add a file to `schemas/categories/`. It drives the register form, validation and passport rendering. No core files change.
- **A new event type** — add it to the event registry and write one decoder function.
- **Postgres instead of SQLite** — set `DATABASE_URL`.
- **Custom reconciliation** — reconciliation rules live in `packages/indexer/src/reconcile.ts`.

See `AGENTS.md` for the full extension guide and the invariants that must hold.

## Security

- The operator key is **server-side only**. It never reaches the browser, and it is never prefixed `NEXT_PUBLIC_`.
- The indexer holds no key at all. It only reads.
- `.env` files are gitignored in every workspace; `.env.example` documents what is needed.
- `passport.state.json` records ids of what you deployed, not secrets, and is gitignored.

## Troubleshooting

Run `yarn passport:status` first — it checks every entity against the mirror node and reports which step is missing.

**`INVALID_FULL_PREFIX_SIGNATURE_FOR_PRECOMPILE` (error 326).** Use `delegatableContractId`, not `contractId`, for HTS key authorization, and set `autoRenewAccount` to `address(this)`. `PassportRegistry` already does both.

**`HtsCreateFailed(9)` on createCollection.** The token creation fee was too low. Raise it: `BOOTSTRAP_COLLECTION_FEE_HBAR=40 yarn passport:bootstrap`. The default is 20 HBAR, which is usually enough on testnet.

**Insufficient balance.** The bootstrap prints the exact shortfall and a per-step cost breakdown before spending anything. Fund the deployer and re-run.

**Deployer shows an EVM address, not a `0.0.x` account id.** Both work with the [faucet](https://portal.hedera.com/faucet). An account only exists on the mirror node once it has been funded, which is why the bootstrap asks you to fund before it can derive the operator id.

**ECDSA vs ED25519.** EVM flows need an ECDSA account. `yarn hardhat:account:generate` creates one.

**Mirror node lag.** The mirror node trails consensus by a second or two, so an entity can 404 immediately after it is created. The bootstrap polls rather than assuming; the UI shows `pending` rather than claiming `verified`.

**CORS errors with hashio.io.** Set `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` to a CORS-enabled endpoint such as [Arkhia](https://arkhia.io/), or rely on wallet-connected operations.

## Disclaimer

The category schemas, including `battery.json`, are illustrative subsets aligned to published regulation. They are a starting point for developers, not legal advice or a certified compliance implementation.

## Links

- [Hedera documentation](https://docs.hedera.com/)
- [HashScan explorer](https://hashscan.io/testnet)
- [HTS system contract reference](https://docs.hedera.com/hedera/core-concepts/smart-contracts/hedera-token-service-hts-precompiled-contract)
- [Hedera portal faucet](https://portal.hedera.com/faucet)

## License

MIT — see [LICENSE](LICENSE).
