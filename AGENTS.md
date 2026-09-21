# Agent instructions

Briefing for coding agents in this repo (Claude Code, Cursor, Codex). Claude Code loads it through `CLAUDE.md`.

**product-passport** — a scaffold-hbar template for Digital Product Passports on Hedera. One HTS NFT serial per physical product, one HCS topic per product as its ordered lifecycle log, a mirror-node-fed indexer that reconciles the two, and a public verify page.

Use `yarn`. Never `npm` or `pnpm` — the static validator fails the build if `package-lock.json` or `pnpm-lock.yaml` appears.

## Invariants

These are not style preferences. Breaking one breaks the template's premise.

1. **HCS is a log, not a database.** Messages are capped at 1024 bytes and validated against `schemas/passport-event.schema.json`. Large content — certificates, images, reports — is referenced by sha256 hash and URL. Never embed it.
2. **The browser never reads HCS.** Reads come from the index API. Acceptance assertion C8 checks this in devtools.
3. **Custody truth comes from the NFT, not from HCS.** HCS carries *claims*. The mirror node's NFT transfer history is what actually happened. Where they disagree, show a `discrepancy` — never reconcile by overwriting one with the other, and never hide it.
4. **Secrets are server-side only.** `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_PRIVATE_KEY` never get a `NEXT_PUBLIC_` prefix and never reach the browser. The indexer holds no key; it only reads.
5. **Everything must work with no `.env`, no keys and no network.** `yarn lint`, `yarn next:check-types`, `yarn next:build`, `yarn hardhat:compile`, `yarn hardhat:test` and `yarn indexer:test` all pass offline. The UI falls back to bundled fixtures.
6. **Never claim `verified` for `pending`.** If the indexer has not caught up, say so.

## Repo map

| Path | Purpose |
| --- | --- |
| `packages/hardhat/contracts/PassportRegistry.sol` | Registry: mint, custody, airdrop, allow-lists |
| `packages/hardhat/contracts/interfaces/IHederaTokenService.sol` | HTS system contract interface — extend, don't rewrite |
| `packages/hardhat/contracts/test/MockHTS.sol` | Local HTS double with an ERC-721 facade per collection |
| `packages/hardhat/scripts/bootstrap.ts` | Zero-to-testnet; idempotent, records `passport.state.json` |
| `packages/hardhat/scripts/status.ts` | Checks every entity against the mirror node; needs no key |
| `packages/hardhat/scripts/lib/events.ts` | Canonicalisation, sha256, event construction |
| `packages/indexer/src/` | Mirror node poller, decoder, store, reconciliation |
| `packages/indexer/src/reconcile.ts` | Where custody claims are checked against NFT transfers |
| `packages/nextjs/app/verify/[serial]/` | Public passport page — no wallet, no env |
| `packages/nextjs/app/api/passport/` | Server routes: topics, events, index queries |
| `packages/nextjs/contracts/deployedContracts.ts` | Generated on deploy — do not hand-edit |
| `schemas/passport-event.schema.json` | The HCS message contract |
| `schemas/categories/` | One file per product category |
| `.harness/` | Incremental PRDs, validators, acceptance contract |

## Commands

```bash
yarn install
yarn lint                      # all three workspaces
yarn format
yarn next:check-types
yarn next:build
yarn hardhat:compile
yarn hardhat:test              # MockHTS unit tests, no network
yarn hardhat:test:forking      # optional, against a Hedera fork
yarn indexer:test
yarn passport:bootstrap        # deploy + collection + topic + demo product
yarn passport:status           # diagnostics, no key needed
```

The harness runs exactly these — see `.harness/validators/yarn.json`. Run them before claiming an increment is done.

## How to extend

### Add a product category

Add one file to `schemas/categories/`. It drives the register form, client-side validation and passport rendering. Core files do not change.

```json
{
  "id": "textile",
  "label": "Textile",
  "fields": [{ "key": "name", "label": "Product name", "type": "string", "required": true }],
  "display": { "title": "name", "subtitle": "manufacturer", "highlights": [] },
  "eventTypes": ["product.shipped", "custody.transferred"]
}
```

### Add an event type

Event types are a registry, not a hardcoded switch. Add the type to the pattern in `schemas/passport-event.schema.json`, then add one decoder function in `packages/indexer/src/events/`. Unknown types are stored as `custom.*` rather than dropped, so an indexer that has not been taught a type still records it.

### Change how reconciliation decides

All of it lives in `packages/indexer/src/reconcile.ts`. A `custody.transferred` event is matched against `/api/v1/tokens/{tokenId}/nfts/{serial}/transactions` by transaction id, or by (from, to) within a time window. Anything unmatched becomes a `discrepancy` with a human-readable note.

### Swap SQLite for Postgres

Set `DATABASE_URL`. No code change.

## Frontend conventions

Use the scaffold hooks from `packages/nextjs/hooks/scaffold-hbar`:

- `useScaffoldReadContract` — NOT `useScaffoldContractRead`
- `useScaffoldWriteContract` — NOT `useScaffoldContractWrite`

DaisyUI classes for layout. Imports use the `~~/` alias for `packages/nextjs/*`.

## Hedera value handling

| Context | Unit | 1 HBAR |
| --- | --- | --- |
| JSON-RPC transaction `value` | wei | 10^18 |
| Contract `msg.value` | tinybars | 10^8 |

Multiply tinybars by 10^10 when sending over JSON-RPC. `getBalance` returns weibars; divide by 10^10 to get tinybars.

## HTS gotchas

- Authorize with `delegatableContractId`, not `contractId`, and set `autoRenewAccount` to `address(this)`. Otherwise HTS returns error 326.
- The supply key bitmask is 16. Treasury and supply key are both the registry.
- HTS calls through `0x167` cost far more gas than plain storage writes. Set explicit gas limits; estimation under-reports them.
- Token creation needs real HBAR as `msg.value`. Too little reverts with `HtsCreateFailed(9)`.

## Terminology

Write **HBAR**, uppercase and singular — never "HBARs" or "hbar". Network names are lowercase: "Hedera testnet", "Hedera mainnet". Hedera is a **hashgraph network**, not a blockchain. Use `@hiero-ledger/sdk`, not `@hashgraph/sdk`.

## Code style

- `UpperCamelCase` for types and components, `lowerCamelCase` for functions and variables.
- Every public Solidity function has NatSpec. Every route validates input and returns typed JSON errors. Every new module has tests.
- Prefer custom errors over revert strings in Solidity.
