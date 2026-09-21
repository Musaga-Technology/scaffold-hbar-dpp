# Increment 01 — Foundation: workspace shape, PassportRegistry contract, bootstrap script

## Goal
Turn the seeded `templates/tokenize-subscriptions` monorepo into the `product-passport` template skeleton and deliver the on-chain registry with tests. No UI work yet beyond keeping the app building.

## Preserve
- Yarn 3.2.3 workspaces, root `next:*` / `hardhat:*` scripts, husky/lint-staged, RainbowKit + burner connector, Debug Contracts page, `hardhat.config.ts` networks (hederaTestnet/hederaMainnet, Hashio RPC), account generate/import scripts, verify scripts.
- `contracts/interfaces/IHederaTokenService.sol`, `contracts/test/MockHTS.sol`, `@hashgraph/system-contracts-forking` fork test setup — extend them, do not rewrite.

## Remove
- Subscription marketplace contracts, deploy scripts, pages (`/marketplace`, `/mint`, `/my-bookings`, `/my-subscriptions`, `/sales`) and their components/hooks. Leave a minimal home page that builds.

## Deliver
1. `template.json` → `name: product-passport`, hardhat capability, outro steps: `yarn hardhat:account:generate` → fund at the faucet → `yarn passport:bootstrap` (deploys, creates collection + topic, registers a demo product) → `yarn indexer:dev` → `yarn next:start` → open `/verify/1`. Five steps, one of which is copy-paste from the faucet; no manual deploy or script-by-hand steps.
2. Add empty-but-building `packages/indexer` workspace (TypeScript, `src/index.ts` prints usage) and root scripts `indexer:dev`, `indexer:replay`, `indexer:verify`, `indexer:test`, `indexer:build`; `lint` must include it.
3. `schemas/passport-event.schema.json` (copy from this kit's `schemas/`), `schemas/categories/{generic,battery,textile}.json`, `schemas/README.md`.
4. `packages/hardhat/contracts/PassportRegistry.sol`:
   - `createCollection(string name, string symbol)` payable → HTS `createNonFungibleToken` (treasury = contract, supply key = contract id key, autoRenew = contract, 7,890,000 s). Store `collection` address; revert if already created.
   - `registerProduct(bytes metadata, bytes32 productHash, string calldata topicId) returns (int64 serial)` → `mintToken` with `[metadata]`; store `products[serial] = Product{topicId, productHash, issuer: msg.sender, exists: true}`; emit `ProductRegistered(int64 serial, string topicId, bytes32 productHash, address issuer)`. Only `owner` or allow-listed issuers.
   - `transferCustody(int64 serial, address to)` → require caller is current holder (query `IERC721(collection).ownerOf(serial)` via the HTS ERC facade; fall back to tracked holder in MockHTS tests) → HTS `transferNFT(collection, from, to, serial)` (contract holds the supply key, not an allowance — for holder-initiated transfers use `transferFrom` on the facade, documented) → emit `CustodyTransferred(serial, from, to)`.
   - `airdropPassport(int64 serial, address to)` (issuer only, while contract is holder) → try HIP-904 `airdropTokens` on 0x167 per the vendored `hts-system-contract` skill; if signature unavailable in the interface, implement as `transferNFT` and document.
   - `setIssuer(address, bool)`, `setEventLogger(int64 serial, address, bool)`, `isEventLogger(serial, addr) view`.
   - `productCount()`, `getProduct(serial)` views. NatSpec on every public function. Solidity 0.8.24+, OpenZeppelin `Ownable`.
5. Tests `packages/hardhat/test/PassportRegistry.test.ts` (Mocha/Chai, MockHTS): createCollection once; register emits event + stores product; non-issuer register reverts; transferCustody by holder succeeds and emits; by non-holder reverts; airdrop path; logger allow-list; ≥ 12 cases. Keep an opt-in fork test (`hardhat:test:forking`) that exercises real system-contract calls.
6. **One-script zero-to-testnet.** `deploy/00_deploy_passport_registry.ts` (hardhat-deploy) plus `packages/hardhat/scripts/bootstrap.ts` exposed as root `yarn passport:bootstrap [--network hederaTestnet]`. The script is the developer's entire path from a funded account to a live passport and must be **idempotent** and **loud**:
   1. Preflight: read deployer (Hardhat account) and operator (`HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_PRIVATE_KEY` from `packages/hardhat/.env`); if operator is missing, derive the operator from the deployer's ECDSA key (same key, resolve `0.0.x` via mirror node `/api/v1/accounts/{evmAddress}`); query balance; abort with the exact shortfall ("balance 3 HBAR, bootstrap needs ~35 HBAR: deploy ~2, collection creation ~20, topic + messages < 1; faucet: portal.hedera.com/faucet").
   2. Deploy `PassportRegistry` if no deployment exists for the network (reuse `hardhat-deploy` artifacts otherwise) and print the HashScan contract link.
   3. `createCollection` if `collection()` is zero, paying the token-creation fee via `msg.value` (`BOOTSTRAP_COLLECTION_FEE_HBAR`, default 20); print token id.
   4. Create the demo product's HCS topic (skip if `passport.state.json` already records one), register the demo product (category `battery`, fixture data), submit `product.registered` with `ref` = mint tx id, submit two more demo events (`product.shipped`, `product.inspected`).
   5. Write `packages/nextjs/.env.local` (`NEXT_PUBLIC_PASSPORT_REGISTRY_ADDRESS`, `NEXT_PUBLIC_PASSPORT_TOKEN_ID`, `NEXT_PUBLIC_HEDERA_NETWORK`) and `packages/indexer/.env.local` (`PASSPORT_REGISTRY_ADDRESS`, `INDEXER_TOPIC_IDS`), and `packages/hardhat/passport.state.json` (all ids, tx ids, timestamps) for idempotency and for `passport:status`.
   6. Print a final block: token, serial 1, topic, contract — each as a HashScan URL — and the next two commands (`yarn indexer:dev`, `yarn next:start`) plus `http://localhost:3000/verify/1`.
   Also add root `yarn passport:status`: reads `passport.state.json`, checks each entity exists via mirror node, prints the indexer cursor from the SQLite DB if present, and shows the deployer/operator balance. Both scripts have unit tests for the preflight math and idempotency branches (mock the network).
7. `.env.example` in hardhat/nextjs/indexer; `README.md` first pass (quick start + architecture sketch); `AGENTS.md` first pass; `CLAUDE.md` pointing at AGENTS.md.

## Non-goals
No indexer logic, no UI pages beyond a building home page, no foundry workspace.

## Acceptance (deterministic)
`yarn install`, `yarn lint`, `yarn hardhat:compile`, `yarn hardhat:test`, `yarn next:check-types`, `yarn next:build`, `yarn indexer:test` (may be a placeholder test) all pass without `.env`.
