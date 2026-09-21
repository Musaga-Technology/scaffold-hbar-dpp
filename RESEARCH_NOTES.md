# Research notes — scaffold-hbar template bounty (compiled 15 Sep 2026)

## The bounty
- Page: https://hedera.com/scaffold-hbar-template-bounty (full brief with rubric NOT public yet — "Read the full brief" redirects to the landing page; expect it by email after registration. Re-score this plan against it when it arrives.)
- One public repo, scaffoldable with `npm create scaffold-hbar@latest --template your-org/your-repo`.
- Every template that clears the eligibility gate is listed in Hedera docs with author credit; five $2,000 prizes.
- Dates: registration 14 Sep · build window 21 Sep–4 Oct · AMA 29 Sep 10:00 ET · judging 5–16 Oct · winners 19 Oct.
- Hedera Harness strongly recommended, not required. If used, submit the harness spec + validators with the repo.

## What already exists (do not compete here)
Built-in template branches on hedera-dev/scaffold-hbar (verified via `git ls-remote`, 15 Sep 2026):
`templates/blank-template`, `bridge`, `cross-chain-dca`, `hedera-demo` (HTS+HCS+mirror, Next.js only), `oracles` (Chainlink/Supra/Pyth), `payments-scheduler` (HIP-1215), `tokenize-subscriptions` (HTS NFT marketplace, Hardhat), `x402-pay-per-use`.
External flagship: `hedera-dev/template-hedera-lz-app` (LayerZero index, pnpm).
Harness example PRDs: Proof Wall (HCS feed), HTS precompile demo, x402 metered API.
Saturated lanes: x402 (own bounty Jul 2026, five winners; weekly AI bounties), AI-agent payments.

## Ruled out on risk
- Hooks (HIP-1195): consensus node 0.74/0.75 release notes say "Disable hooks by default" → not usable on public testnet; would fail the works-on-testnet gate. Mirror node support is complete, but that does not help.
- v0.77 features (Pectra/EIP-7702): testnet date TBD.

## Live and safe to use (testnet + mainnet, as of 0.76 — mainnet 28 Aug, testnet 1 Sep 2026)
- HTS system contract 0x167 incl. HIP-904 airdrop functions; HIP-1215 scheduled contract calls (0x16b); atomic batch (HIP-551); HIP-991 fee-charging topics; HIP-632 `isAuthorized`; mirror node REST incl. `/api/v1/topics/{id}/messages`, `/api/v1/tokens/{id}/nfts/{serial}/transactions`, `/api/v1/contracts/results`.
- HCS ConsensusSubmitMessage base fee rose from $0.0001 to $0.0008 in Jan 2026 — design events to be compact.

## Signals from Hedera itself
- 8 Sep 2026 blog by Ty Smith (Sr PM): "Use HCS for ordered proof, use an index for queries" — prescribes HCS event log + mirror-node-fed indexer + DB; names supply chain custody, compliance attestations, provenance streams as target workloads; ends with "write ten state transitions, rebuild state from mirror node, compare". No template implements this.
- 4 Sep 2026: WISeKey joins Council as Strategic Partner (digital identity, IoT) — identity/provenance timing is good.
- Use-case pillars with ZERO template coverage: Asset Tokenization, Decentralized Identity, Sustainability, Consumer Engagement.

## Real-world driver for the chosen use case
- EU battery passport mandatory from 18 Feb 2027 (Reg. 2023/1542) for EV, industrial >2 kWh and LMT (e-bike) batteries. ESPR (2024/1781) working plan: iron/steel delegated act 2026, textiles ~2027, furniture 2028. GS1 Digital Link is the expected data-carrier URI format.

## Tooling facts that shape the build
- Harness is schema v2: recipe lives in `.harness/` inside the project; `npx hedera-harness init`, `doctor`, `run`, `validate`, `validate-semantic`; `agent: claude` supported; incremental `prd:` lists; Tier 0–1 default, Tier 2 Playwright, Tier 3 acceptance contract, Tier 3.5 chain validation (ECDSA operator via env, burner wallet injected as `burnerWallet.pk`).
- Seed branch: `templates/tokenize-subscriptions` — Hardhat, `contracts/interfaces/IHederaTokenService.sol`, `contracts/test/MockHTS.sol`, `@hashgraph/system-contracts-forking` for local fork tests, RainbowKit + burner-connector, `packages/hardhat/scripts/createCollection.ts` pattern (token create paid with `msg.value`).
- Port from `templates/hedera-demo`: `services/hederaClient.ts` (env `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_PRIVATE_KEY`, `HEDERA_NETWORK`), `services/mirrorNode.ts` (`fetchTopicMessages`), `app/api/hedera/airdrop/route.ts` (TokenAirdropTransaction with TransferTransaction fallback), `NativeTransactionSignerBridge` + `@hashgraph/hedera-wallet-connect` if native wallets are wanted.
- Conventions: Yarn 3.2.3 workspaces (`packageManager: yarn@3.2.3`), Node ≥ 20.18.3, root scripts `next:*` / `hardhat:*`, `template.json` with `create-scaffold-hbar.capabilities/defaults/outro`, `AGENTS.md` + `CLAUDE.md` at root, prefer `@hiero-ledger/sdk` over `@hashgraph/sdk`, ECDSA accounts for EVM flows, write "HBAR" singular uppercase, network names lowercase.
- Hedera Skills to vendor via `skills:` in the recipe: `hts-system-contract`, `hss-system-contract`, `hedera-token-service`, `hedera-consensus-service`, `project-scaffolding` (names resolve through hedera-harness `skills-index.json`).

## Sources
hedera.com/scaffold-hbar-template-bounty · hedera.com/blog/deploy-multichain-dapps-on-hedera-in-60-seconds-with-scaffold-hbar · docs.hedera.com/solutions/tools/scaffold-hbar · github.com/hedera-dev/hedera-harness (README + docs/authoring-a-recipe.md, commit e045b10, 16 Aug 2026) · github.com/hedera-dev/hedera-skills · hedera.com/blog/how-to-unlock-the-full-potential-of-hcs-and-why-it-is-not-a-database · docs.hedera.com/hedera/networks/release-notes/services · hips.hedera.com (904, 991, 1195, 1215) · EU DPP timelines (passportcraft.com, solvedpp.com, avl.com)
