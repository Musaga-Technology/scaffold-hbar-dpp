# product-passport — Provenance & Digital Product Passports on Hedera

**Template key (external):** `<your-org>/scaffold-hbar-product-passport`
**One command:** `npm create scaffold-hbar@latest my-passports -- --template <your-org>/scaffold-hbar-product-passport`

## 1. Product brief

Build a production-quality **scaffold-hbar template** that gives any team a working Digital Product Passport (DPP) / provenance system on Hedera in one command.

Every physical product (a battery, a garment, a pallet of coffee, a pharmaceutical lot) gets:

1. an **HTS non-fungible token** — the passport — minted through a Solidity registry contract using the HTS system contract, with HIP-412 metadata pointing at the product's event topic;
2. an **HCS topic** — the ordered, consensus-timestamped lifecycle log (manufactured → shipped → custody-transferred → inspected → repaired → recycled), where each message is a compact, hash-anchored event;
3. an **indexer** — a small worker that reads the mirror node, replays events deterministically into a local database, and reconciles the HCS story against on-chain NFT custody;
4. a **Next.js app** — issuer dashboard, custody transfer, and a public QR-verifiable `/verify/[serial]` page that renders the timeline from the index with HashScan links for every claim.

The template teaches the architecture Hedera itself prescribes for HCS: *HCS records what happened so it can be trusted later; a database answers queries.* It is configurable by product category (JSON schema per category) so the same scaffold serves batteries, textiles, food, or pharma.

## 2. Why this template (for README "Why" section and pitch)

- **Real deadline, real buyers.** EU battery passports are mandatory from 18 Feb 2027; ESPR extends DPPs to steel, textiles, furniture and electronics through 2030. Every brand selling into the EU needs a reference implementation.
- **The canonical HCS pattern.** Implements "HCS for ordered proof, an index for queries" end-to-end, including the replay-and-compare check from Hedera's own guidance, as a one-line script.
- **Hedera-only capabilities.** Native NFT compliance keys, consensus timestamps, HIP-904 airdrops (consumer receives the passport without pre-association), mirror node as the indexing source, and HTS-from-Solidity through the 0x167 system contract.
- **Uncontested lane.** No built-in template covers sustainability, supply chain or provenance.

## 3. Who it is for

- Supply-chain / sustainability developers who need a DPP or provenance MVP fast.
- Enterprise teams evaluating Hedera for traceability (they want the indexer + reconciliation, not a toy feed).
- Hackathon builders needing a credible "HCS + HTS done right" starting point.
- AI coding agents extending the template (AGENTS.md documents the event schema, the indexer contract and the extension points).

## 4. Core user journeys

### J1 — Public verification (no wallet, no `.env`; must work on a fresh scaffold)
A stranger opens `/` and `/verify/[serial]` (or scans the QR). They see:
- the product's identity (category, name, manufacturer, serial), the HTS token ID and serial, the HCS topic ID;
- the ordered lifecycle timeline with consensus timestamps, event type, actor, payload summary, and a HashScan link per event (topic message) and per custody change (NFT transfer);
- a **verification status** badge: `verified` (every custody event in HCS matches an NFT transfer on mirror node and hashes match), `pending` (indexer catching up), `discrepancy` (mismatch — shown honestly, never hidden).
- Without env vars, the app serves bundled **demo fixtures** (a sample passport + events + reconciliation) so the UI is fully explorable offline. A clear banner says "Demo data — configure `.env` to index a live registry".

### J2 — Issuer: register a product (wallet required, EVM)
On `/issuer`, the connected deployer/issuer:
- picks a category schema (e.g. `battery`, `generic`), fills the required fields (validated client-side from the JSON schema);
- clicks **Register** → the app creates an HCS topic for the product (server route, operator key) and calls `PassportRegistry.registerProduct(...)` which mints one NFT serial via HTS and stores `serial → topicId` + `productHash`;
- the app submits the first HCS event `product.registered` referencing the mint transaction id;
- UI shows token ID, serial, topic ID, and the QR (GS1 Digital Link–style URL: `/01/{gtin}/21/{serial}` mapped to `/verify/{serial}`; plain `/verify/{serial}` when no GTIN).

### J3 — Log a lifecycle event (wallet or operator)
On `/issuer/[serial]`, an authorised actor logs `shipped`, `inspected`, `repaired`, `recycled`, or a custom typed event. The event is validated against the schema, its payload hashed (SHA-256), and the compact message submitted to the product topic. Large attachments (PDF certificates, images) are **not** put on HCS — only their hash + an off-chain URL/CID.

### J4 — Custody transfer (wallet required, EVM)
Current holder calls `PassportRegistry.transferCustody(serial, to)` → HTS NFT transfer through the system contract; then the app records `custody.transferred` on HCS with the transfer transaction id. Indexer later reconciles both.

### J5 — Consumer claim via airdrop (wallet required)
Issuer enters the buyer's account id / EVM address → contract (`airdropPassport`) or server route (`TokenAirdropTransaction`) airdrops the NFT (HIP-904); buyer sees it in `/my-passports` and can claim if pending. Documented fallback: direct `transferNFT` when the receiver has unlimited automatic associations.

### J6 — Indexer operator
`yarn indexer:dev` tails the mirror node for the registry's topics and NFT transfers; `yarn indexer:replay` rebuilds state from genesis into a fresh DB; `yarn indexer:verify` replays and diffs against the live DB and prints a reconciliation report (the "ten transitions" check from Hedera's HCS guidance).

## 5. App surface

| Route | Purpose | Wallet |
|---|---|---|
| `/` | Landing: what a passport is, registry stats from index, search by serial, link to demo passport | no |
| `/verify/[serial]` | Public passport page + timeline + verification status + QR | no |
| `/issuer` | Register product (schema-driven form), list registered products | yes |
| `/issuer/[serial]` | Log events, transfer custody, airdrop to consumer | yes |
| `/my-passports` | Passports held by the connected wallet; claim pending airdrops | yes |
| `/debug` | scaffold-hbar Debug Contracts (keep) | yes |
| `/api/passport/*` | Server routes: create topic, submit event, airdrop, index queries | n/a |

## 6. Architecture

```
packages/
  hardhat/            PassportRegistry.sol (HTS system contract), tests (MockHTS + fork), deploy + createCollection script
  nextjs/             App Router UI, /api/passport/* routes (Hiero SDK server-side), schema-driven forms, QR
  indexer/            Node worker: mirror-node poller → event decoder → Drizzle (SQLite default, Postgres via DATABASE_URL) → reconciliation
schemas/              product-category JSON schemas + passport-event.schema.json
.harness/             harness recipe, incremental PRDs, validators, acceptance contract
```

**Data flow.** Writes go through two truth sources: the contract/HTS (custody, existence) and HCS (what happened, in what order). The indexer joins them: for each `custody.transferred` event it looks up `/api/v1/tokens/{tokenId}/nfts/{serial}/transactions` and marks the event `reconciled` or `discrepancy`. Reads never hit HCS or the contract directly — they hit the index (SQLite via a Next.js route in dev; the index API in prod).

**Event model (HCS message, JSON, ≤1 KB).** See `schemas/passport-event.schema.json`. Required: `v` (schema version), `type`, `serial`, `tokenId`, `ts` (client time; consensus time is authoritative), `actor` (EVM address or account id), `payloadHash` (sha256 of canonical JSON payload), `payload` (small, typed), optional `ref` (Hedera transaction id or previous message sequence), optional `sig` (actor signature over `payloadHash`, EIP-191). Unknown fields are ignored by the indexer; unknown `type`s are stored as `custom.*`.

**Contract (Solidity ≥0.8.24).** `PassportRegistry`:
- `createCollection(name, symbol)` — HTS `createNonFungibleToken` with contract as treasury + supply key; payable (token creation fee via `msg.value`).
- `registerProduct(bytes metadata, bytes32 productHash, string topicId)` → `mintToken` → returns serial; stores `Product{topicId, productHash, issuer}`; emits `ProductRegistered(serial, topicId, productHash)`.
- `transferCustody(serial, to)` — only current holder (HTS `ownerOf` via IERC721 facade or tracked owner) → `transferNFT` (or `transferFrom`) ; emits `CustodyTransferred(serial, from, to)`.
- `airdropPassport(serial, to)` — HIP-904 `airdropTokens` on 0x167 (verify signature in the vendored `hts-system-contract` skill `api.md`; fall back to `transferNFT` if unavailable).
- `setEventLogger(address, bool)` — allow-list of accounts permitted to log events for issuer-owned products (used by UI to gate J3 client-side; HCS itself is append-only).
- Freeze/pause keys deliberately **not** set by default (passports must remain transferable); documented as an option for regulated categories.

**Metadata.** HIP-412 JSON: `name`, `description`, `image` (optional), `type`, `properties.category`, `properties.topicId`, `properties.productHash`, `properties.verifyUrl`. Stored as an off-chain URL or inline data URI (configurable); the on-chain bytes stay < 100 bytes when using a URL.

## 7. Hedera integration expectations

- **HTS via system contract (0x167)** from Solidity: create NFT collection, mint, transfer, airdrop. Tests run against `MockHTS.sol` locally and against the Hedera fork (`@hashgraph/system-contracts-forking`).
- **HCS via `@hiero-ledger/sdk`** in server routes: `TopicCreateTransaction` (submit key = operator, memo = `passport:{tokenId}:{serial}`), `TopicMessageSubmitTransaction`. Never from the browser.
- **Mirror node REST** as the only read source for the indexer: topic messages (paginate with `sequencenumber=gt:`), NFT transactions, contract results/logs for `ProductRegistered`.
- **HIP-904 airdrop** in both forms (contract call and SDK `TokenAirdropTransaction`), with the pending-airdrop claim shown in `/my-passports`.
- **HashScan** links for token, serial, topic, and every transaction id.
- No hooks (HIP-1195): disabled on public networks as of 0.76.

## 8. Template-ness (what makes it a starting point, not a demo)

- `schemas/categories/{generic,battery,textile}.json` drive the register form, validation and passport rendering. Adding a category = adding a file.
- Event types are a registry (`packages/nextjs/lib/events.ts` + `packages/indexer/src/events/`); new types need one decoder function.
- Indexer storage adapter: SQLite by default (zero setup), Postgres via `DATABASE_URL`.
- `AGENTS.md` documents: event schema rules, where to add a category, where to add an event type, how reconciliation works, what must never go on HCS, and the commands the validators run.

## 9. Constraints

- Yarn 3 workspaces only (no npm/pnpm). Node ≥ 20.18.3.
- `yarn install && yarn lint && yarn next:check-types && yarn next:build && yarn hardhat:compile && yarn hardhat:test && yarn indexer:test` must pass **without** `.env`, keys, or network access beyond package install.
- No committed secrets; `.env.example` at root of each workspace; operator key only server-side.
- Prefer `@hiero-ledger/sdk`; ECDSA accounts for EVM flows; write "HBAR" (uppercase, singular), "Hedera testnet" (lowercase network).
- Keep scaffold-hbar conventions: RainbowKit/wagmi/viem + burner connector (Tier 3.5 needs it), DaisyUI, `useScaffoldReadContract/WriteContract`, Debug Contracts page, `README.md`, `AGENTS.md`, `CLAUDE.md`, `template.json` with `outro`.
- Compact HCS messages only (fee is $0.0008 per submit; large blobs are a bug).

## 10. Deliverables

- `template.json` (hardhat capability, outro with exactly: generate account → faucet → `yarn passport:bootstrap` (deploys the registry, creates collection + topic, registers a demo product, writes env files) → `yarn indexer:dev` → `yarn next:start`). `yarn passport:status` for diagnostics.
- Hosting: Vercel button for the app (works with zero env via fixtures), Dockerfile + docker-compose (indexer + Postgres), Fly/Railway notes. Deployment is always an explicit command after funding — never a side effect of scaffolding or CI.
- `packages/hardhat` with contract, interface, MockHTS, ≥ 12 unit tests, fork test, deploy scripts, `scripts/bootstrap.ts`.
- `packages/nextjs` routes above, schema-driven forms, QR via `qrcode.react`, fixtures for offline demo mode.
- `packages/indexer` with poller, decoder, Drizzle schema + migrations, reconciliation, CLI (`dev`, `replay`, `verify`), ≥ 8 tests using recorded mirror-node JSON fixtures.
- `schemas/` with JSON Schemas and README.
- Root `README.md` (quick start ≤ 10 commands, architecture diagram, "why HCS + index", DPP context, extension guide, troubleshooting), `AGENTS.md`, `CLAUDE.md`, `LICENSE` (MIT), 60–90 s demo GIF/video link.
- `.harness/` recipe with validators, Playwright smoke and acceptance contract (this kit).

## 11. Success criteria (human review)

1. Fresh machine: one command scaffolds; `yarn install && yarn next:start` shows a working passport page from fixtures with no config.
2. With a funded testnet ECDSA account: a single `yarn passport:bootstrap` deploys and produces a real collection, topic and first event visible on HashScan; `yarn indexer:dev` indexes it within 30 s; `/verify/1` shows `verified`.
3. `yarn indexer:verify` reports zero discrepancies on the bootstrap data, and a deliberately forged HCS custody event (documented test) is flagged `discrepancy`.
4. A reviewer can add a new product category and a new event type by following AGENTS.md without touching core files.
5. No secrets, no npm/pnpm, no HCS-as-database anti-patterns (reads only from the index).

## 12. Out of scope (v1)
Mainnet deployment guide beyond a checklist; DID/verifiable-credential attestations (planned increment 05); Guardian/dMRV integration; IPFS pinning service (document how to plug one in); multi-tenant issuers; on-chain access control beyond issuer/holder/logger allow-list.
