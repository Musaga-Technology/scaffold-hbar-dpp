# Kickoff prompt for Claude Code — product-passport scaffold-hbar template

Paste this as the first message in Claude Code, from inside the freshly seeded repo (see "Before you start").

---

You are building `product-passport`, a production-quality **scaffold-hbar template** for the Hedera scaffold-hbar template bounty (build window 21 Sep–4 Oct 2026). Read, in this order, before writing any code:

1. `PRD.md` — the product brief and architecture. It is the source of truth.
2. `.harness/prds/01…04` — the ordered increments. Work strictly in that order; do not start an increment until the previous one's deterministic acceptance passes.
3. `.harness/validators/static.json`, `.harness/validators/yarn.json`, `.harness/validators/playwright-smoke.yaml`, `.harness/acceptance-contract.json` — these are what will be graded. Treat every required file, text needle and command as a hard requirement.
4. `schemas/` — the event and category schemas; generate types from them, do not hand-write divergent types.
5. `RESEARCH_NOTES.md` — ecosystem facts and conventions (verified 15 Sep 2026).
6. `AGENTS.md` and `CLAUDE.md` of the seeded repo — scaffold-hbar conventions you must keep.
7. Vendored Hedera skills under `.harness/runtime/skills/` (after `npx hedera-harness init`) or install with `npx skills add hedera-dev/hedera-skills --all` — use `hts-system-contract/references/api.md` for exact HTS system-contract signatures (createNonFungibleToken, mintToken, transferNFT, airdropTokens) and `hedera-consensus-service` for topic patterns.

Non-negotiable invariants:
- Yarn 3.2.3 workspaces only. Never run npm/pnpm. Node ≥ 20.18.3.
- All validator commands must pass with **no `.env`, no keys, no network** (package install excepted). Fixture mode must make the UI fully explorable offline.
- Never commit secrets. Operator keys are server-side only (`HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_PRIVATE_KEY`, `HEDERA_NETWORK`). Use `@hiero-ledger/sdk`, not `@hashgraph/sdk`.
- HCS messages are compact (≤ 1024 bytes), typed, hash-anchored. Large content never goes on HCS. The browser never reads HCS directly; it reads the index API.
- Reads of custody truth come from mirror node NFT data; HCS is the claim log. Discrepancies are shown, never hidden.
- Keep scaffold-hbar conventions (RainbowKit + burner connector, DaisyUI, scaffold hooks, Debug Contracts, root `next:*`/`hardhat:*` scripts, `template.json` outro).
- Terminology: "HBAR" (uppercase, singular), "Hedera testnet" (lowercase network), "Hedera" is a hashgraph network, not a blockchain.
- Every public Solidity function has NatSpec. Every route validates input and returns typed JSON errors. Every new module has tests.
- After each increment: run `yarn lint && yarn next:check-types && yarn hardhat:compile && yarn hardhat:test && yarn indexer:test && yarn next:build`, fix everything, then `npx hedera-harness validate` (Tier 0–1) and commit with a message `feat(NN): …`.

Working style: plan the increment in a short checklist first, then implement file by file, run the commands, and report what moved (files, tests added, validators passing). Ask before deviating from PRD.md; if an HTS system-contract signature in the skill reference differs from the seed's `IHederaTokenService.sol`, trust the skill reference and extend the interface.

Start with increment 01 now.

---

## Before you start (human steps, ~30 min)

```bash
# 1. Register for the bounty (done?) and create the public repo <your-org>/scaffold-hbar-product-passport

# 2. Seed from the first-party HTS-from-Solidity template
npm create scaffold-hbar@latest scaffold-hbar-product-passport -- \
  --template tokenize-subscriptions --frontend nextjs-app --solidity-framework hardhat \
  --network testnet --package-manager yarn
cd scaffold-hbar-product-passport
git init && git add -A && git commit -m "chore: seed from scaffold-hbar templates/tokenize-subscriptions"

# 3. Drop this kit in
cp -r /path/to/kit/{PRD.md,RESEARCH_NOTES.md,CLAUDE_CODE_KICKOFF.md,schemas,.harness} .

# 4. Adopt the harness (keeps your .harness/, vendors skills, checks the host)
npm install -D hedera-harness
npx hedera-harness init        # existing package.json → adopt in place; reports what it kept
npx hedera-harness doctor      # fix anything red before a run
git add -A && git commit -m "chore: add PRD, schemas and harness recipe"

# 5. Testnet account (ECDSA!) for later tiers — export in the shell, never in files
#    portal.hedera.com → create ECDSA account → faucet
export HEDERA_OPERATOR_ID=0.0.xxxx
export HEDERA_OPERATOR_KEY=0x...
```

Two ways to build:
- **Interactive (recommended for 01–02):** open Claude Code in the repo and paste the prompt above.
- **Harness-driven (good for 03–04 and for the final proof):** `npx hedera-harness run` executes the increments with validation and repair on a `harness/run-*` branch; review and merge. Enable `chainValidation` in `.harness/spec.yaml` only on a machine with the operator exported.

## Submission checklist (Oct 3–4)
- [ ] Fresh machine / fresh clone: `npm create scaffold-hbar@latest test -- --template <your-org>/scaffold-hbar-product-passport` works; outro steps are accurate.
- [ ] `yarn install && yarn next:start` → `/verify/1` renders from fixtures with no config.
- [ ] Testnet run recorded: `yarn passport:bootstrap` → `yarn indexer:dev` → verified passport; HashScan links in README; `yarn passport:status` output pasted.
- [ ] Vercel deploy of the app renders `/verify/1` from fixtures with zero env; `docker compose up indexer` works.
- [ ] `yarn indexer:verify` output pasted in README; forged fixture shows `discrepancy`.
- [ ] `.harness/` committed with spec, PRDs, validators, contract; `npx hedera-harness validate` green; Tier 2/3 run artifacts summarized in `docs/harness-report.md`.
- [ ] README: why, quick start, architecture, journeys, extension guide, DPP context, troubleshooting, demo GIF.
- [ ] No secrets (`git log -p | grep -i "operator_key"` clean), MIT LICENSE, author credit line, repo public.
- [ ] Submit repo URL + harness spec per the brief's form.
