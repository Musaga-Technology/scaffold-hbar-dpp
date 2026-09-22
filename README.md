# product-passport

**Give a physical product a public, verifiable history.** A battery, a garment, a
pallet of coffee. Scan a QR code, see everything that happened to it, and check
every claim against Hedera yourself.

```bash
npm create scaffold-hbar@latest my-passports -- --template Musaga-Technology/scaffold-hbar-dpp
```

A scaffold-hbar template. Next.js + Hardhat + a mirror-node indexer + IPFS or
Arweave for the documents.

**What makes this more than a database with a blockchain attached:**

- **Certificates are content-addressed, and re-checked.** A conformity
  declaration or test report lives on IPFS or Arweave, and the passport stores
  its content address plus a hash. The indexer fetches each one back, re-hashes
  it, and compares. A document swapped after it was signed off shows up as
  **replaced** — not a broken link, not a green tick.
- **Custody is reconciled, not asserted.** The event log says what someone
  *claimed* happened. The token's transfer history says what the network
  actually recorded. Where they disagree the passport shows a **discrepancy**
  instead of quietly picking one.
- **Nothing here asks for trust.** Every claim links to HashScan, and
  `yarn indexer:verify` rebuilds the whole index from the ledger to prove it
  matches.

Remove the storage layer and a passport's documents become URLs that may or may
not still be what was attested — which for a regulated product is most of the
record. That is why it is part of the template rather than an add-on.

---

## See it working — 30 seconds, no account

```bash
yarn install
yarn next:start
```

Open **http://localhost:3000/verify/1**.

That is a battery passport, running on bundled demo data. Now open
**/verify/2** — a garment whose inspection document was swapped after it was
signed off. The page says so, in red, instead of showing a green tick.

That contrast is the entire point of the template. Everything below is how to do
it with real products.

## Put a real passport on Hedera — 5 commands

You need **Node ≥ 20.18.3** and a funded **ECDSA** Hedera account. The portal
offers ECDSA and ED25519; only ECDSA works here.

```bash
yarn install
yarn hardhat:account:generate     # or account:import if you already have a key
# fund the printed address at https://portal.hedera.com/faucet  (~25 HBAR)
yarn passport:bootstrap           # deploys, then registers one demo product
yarn indexer:dev                  # reads the mirror node, checks every claim
yarn next:start                   # http://localhost:3000/verify/1
```

`passport:bootstrap` is idempotent — if it fails halfway, fix the cause and run
it again. Finished steps are skipped, not paid for twice. If anything looks
wrong, `yarn passport:status` checks every entity against the mirror node.

> **It registers a product for you.** When the bootstrap finishes you already own
> a live passport: serial 1, with a topic carrying its first three lifecycle
> events. `/verify/1` is now that product, not the demo.

## Register your own products

The bootstrap is setup. **The issuer page is the actual tool.**

Open **http://localhost:3000/issuer** and connect a wallet.

| Step | Where | What happens |
| --- | --- | --- |
| 1. Register a product | `/issuer` | Creates an HCS topic, mints one NFT serial against it, writes the first event |
| 2. Log what happens to it | `/issuer/[serial]` | Shipped, inspected, repaired — each one a hash-anchored message on its topic |
| 3. Attach documents | `/issuer/[serial]` | Certificates and reports, stored by content address and re-checked later |
| 4. Hand it over | `/issuer/[serial]` | Transfer custody to another wallet, or airdrop it to the buyer |
| 5. Anyone verifies | `/verify/[serial]` | No wallet, no account, no permission needed |

Pick the product type from the category dropdown. **A category is just a JSON
file** in `schemas/categories/` — battery, textile and generic ship as examples.
Adding food, pharmaceuticals or machine parts means adding a file, not writing
code.

## How it works, briefly

```
your product  ──┬──  HTS NFT serial      "which item is this, and who holds it"
                │
                ├──  HCS topic           "what happened to it, in what order"
                │
                └──  IPFS / Arweave      "the certificates, by content address"
                          │
                     indexer ──── reads all three from the mirror node,
                                  checks they agree, and serves the answer
```

The interesting part is the last line. HCS carries *claims* — someone said this
product shipped. The NFT's transfer history is what actually happened. The
indexer compares them, and where they disagree the passport says **discrepancy**
rather than quietly picking one.

It does the same for documents: fetches each one back, re-hashes it, and
compares against the digest committed on HCS. That is what `/verify/2`
demonstrates.

Reads never touch HCS directly — they come from the index, which is rebuildable
from the mirror node at any time. `yarn indexer:verify` proves it by replaying
from scratch and diffing.

Why it is built this way: [docs/design-notes.md](docs/design-notes.md).

## Proof it runs on Hedera testnet

Bootstrapped 21 September 2026. Open any of these:

| | |
| --- | --- |
| Registry contract | [`0xCBc3089c…5f22D5a7A`](https://hashscan.io/testnet/contract/0xCBc3089cb39ef55114341Ff1aB9BFeA5f22D5a7A) |
| Collection | [`0.0.10649382`](https://hashscan.io/testnet/token/0.0.10649382) |
| Passport serial 1 | [`0.0.10649382/1`](https://hashscan.io/testnet/token/0.0.10649382/1) |
| Lifecycle topic | [`0.0.10649383`](https://hashscan.io/testnet/topic/0.0.10649383) |

Read the topic yourself, without trusting this page:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10649383/messages?order=asc" \
  | jq -r '.messages[] | "\(.sequence_number) \(.message|@base64d)"'
```

## What you need installed

| Path | Requirement |
| --- | --- |
| Explore offline | Node ≥ 20.18.3. Corepack ships with Node and provides Yarn 3.2.3. |
| Run on testnet | The same, plus a funded ECDSA account. |
| Run everything in containers | Docker. No Node, no Yarn, no Solidity toolchain. |

`yarn install` pulls about 2.6 GB — Next.js, RainbowKit and the Solidity
toolchain, mostly inherited from scaffold-hbar. If you only want to *run* the
template, `docker compose up` needs Docker alone.

## Commands

| Command | What it does |
| --- | --- |
| `yarn passport:bootstrap` | Zero to a live passport on Hedera testnet |
| `yarn passport:status` | Check every entity against the mirror node |
| `yarn indexer:dev` | Poll, reconcile, serve the index API |
| `yarn indexer:replay` | Drop the index and rebuild from sequence 1 |
| `yarn indexer:verify` | Replay into a temp index and diff it against the live one |
| `yarn next:start` | Run the app |
| `yarn lint` · `yarn next:build` · `yarn hardhat:test` · `yarn indexer:test` | The gates CI runs |
| `yarn hardhat:test:forking` | Optional — runs the contract against the real HTS precompile on a fork |

## Deploy it

```bash
docker compose up
```

App, indexer and Postgres on any container host — laptop, VM, on-prem, any
cloud. Nothing here is tied to a vendor. Fly, Railway, Render and ECS all take
the same containers.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

One-click preview of the **public page only**. Serverless platforms cannot run
the indexer — it needs a persistent process and a database — so a passport
deployed this way shows demo data until `INDEX_API_URL` points at an indexer
hosted somewhere that can run one.

## Configure it

Everything runs with no configuration at all. These are for connecting it to
something real — full table in [docs/configuration.md](docs/configuration.md).

| Variable | Where | For |
| --- | --- | --- |
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_PRIVATE_KEY` | app, **server-side only** | Creating topics, submitting events |
| `PINATA_JWT` *or* `ARWEAVE_JWK` | app, server-side only | Storing documents |
| `INDEX_API_URL` | app | Where to read the index; unset means demo fixtures |
| `INDEXER_TOPIC_IDS` / `PASSPORT_REGISTRY_ADDRESS` | indexer | What to index |
| `DATABASE_URL` | indexer | Use Postgres instead of SQLite |

The operator variables deliberately have **no** `NEXT_PUBLIC_` prefix — that
would inline the key that signs every HCS submission into the browser bundle.
Leave them unset and the two write routes return 503 with instructions.

## Extend it

| To do this | Change this | Code changes |
| --- | --- | --- |
| Add a product category | one file in `schemas/categories/` | none |
| Add an event type | the schema pattern + one decoder | one function |
| Change how reconciliation decides | `packages/indexer/src/reconcile.ts` | that file only |
| Swap the storage provider | `packages/nextjs/services/storage/` | one `put` method |
| Swap SQLite for Postgres | set `DATABASE_URL` | none |

`AGENTS.md` is the briefing for coding agents working in this repo.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "No deployer account is configured" | Run `account:generate`, or `account:import` if you already have a key |
| `HtsCreateFailed(9)` | Token creation fee too low — raise `BOOTSTRAP_COLLECTION_FEE_HBAR` |
| Passport stuck on `pending` | The indexer has not caught up. Is `yarn indexer:dev` running? |
| Issuer page says "No registry configured" | Run `yarn passport:bootstrap` first |
| Anything else | `yarn passport:status` — it checks every entity and needs no key |

`npx hedera-harness validate` reports `packages/hardhat/.env` as a forbidden file
once you have run `account:generate` or `account:import`. That is expected and
local-only: the file is gitignored, never committed, and holds an *encrypted*
keystore rather than a raw key. A fresh clone has no `.env` and validates clean.

## Links

- [Design notes](docs/design-notes.md) — why it is built this way
- [Configuration](docs/configuration.md) — every environment variable
- [AGENTS.md](AGENTS.md) — briefing for coding agents
- [Hedera docs](https://docs.hedera.com) · [HashScan testnet](https://hashscan.io/testnet) · [Portal faucet](https://portal.hedera.com/faucet)

## Disclaimer

Example code for building on Hedera. Audit before production use. Passports are
public by design — anything written to a topic is readable by anyone, forever.

## License

MIT. Copyright (c) 2026 Musaga Technology, with the upstream BuidlGuidl and
hedera-dev notices retained in [LICENSE](LICENSE).
