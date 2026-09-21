# Increment 04 — Consumer airdrop & claim, /my-passports, docs, template polish

## Goal
Finish J5–J6, make the template feel finished, and make the README the best HCS+HTS explainer in the ecosystem.

## Deliver
0. **Hosting, made trivial (never required by validators).**
   - `packages/nextjs/vercel.json` (already present in the seed — verify) and a "Deploy with Vercel" button in README pointing at the repo with `NEXT_PUBLIC_*` env prompts; the deployed preview must render the fixture passport with zero env so a first deploy is never broken. Document that server routes needing the operator key work on Vercel once `HEDERA_OPERATOR_*` are set as encrypted env vars.
   - `packages/indexer/Dockerfile` (multi-stage, Node 20 slim, non-root) and root `docker-compose.yml` with `indexer` + `postgres` services and a `DATABASE_URL` wiring; `yarn indexer:dev` stays the zero-setup SQLite path. README section "Run the indexer 24/7" with Docker Compose, Fly.io and Railway one-liners (config files for Fly (`fly.toml`) included; Railway via the Dockerfile).
   - A GitHub Actions `deploy-check.yml` that only builds the Docker image (no push, no secrets) so the Dockerfile cannot rot.
   - `yarn passport:status` surfaced in README troubleshooting as the first thing to run when something looks wrong.
1. Airdrop: on `/issuer/[serial]`, "Send to consumer" form accepting `0.0.x` or an EVM address; two paths behind `NEXT_PUBLIC_AIRDROP_MODE`: `contract` (write `airdropPassport`) and `operator` (POST `/api/passport/airdrop` using `TokenAirdropTransaction` with the hedera-demo `TransferTransaction` fallback — only valid when the operator account is the holder). Emit `custody.transferred` event with `ref`. Document HIP-904 semantics: pending airdrop until claimed unless receiver has unlimited auto-associations.
2. `/my-passports`: wallet gate; list held serials via mirror node `GET /api/v1/accounts/{id}/nfts?token.id=` (through a server route), plus pending airdrops via `GET /api/v1/accounts/{id}/pending-airdrops` with a "Claim" action (server route `claimAirdrop` is impossible without the receiver's key — so implement claim via wallet using the HTS system contract `claimAirdrops` if the interface supports it, otherwise show instructions + HashPack deep link). Each entry links to `/verify/[serial]`.
3. `README.md` (final): badges; one-paragraph pitch; **"From zero to a live passport in 5 commands"** block at the very top; "Why HCS + an index (and why not HCS as a database)" with the fee note; architecture diagram (Mermaid); quick start (fixtures → testnet); the six journeys with screenshots/GIF; commands table; event schema summary; extension guide (new category, new event type, Postgres, custom reconciliation rule); DPP/GS1 context and disclaimers; troubleshooting (unfunded account, token-creation fee, ECDSA vs ED25519, mirror node lag, chunked messages); security notes (operator key server-only; what never goes on HCS); license.
4. `AGENTS.md` (final): repo map, invariants (compact events, reads from index only, no secrets, yarn only), how to add category/event type, how reconciliation decides, validators the harness runs, style rules for Hedera terms.
5. `template.json` outro verified against real CLI behaviour (`{run:...}` placeholders).
6. Lint/format clean; `yarn hardhat:test` and `yarn indexer:test` counts reported in README; CI workflow `.github/workflows/ci.yml` running the yarn.json commands on Node 20.
7. Demo assets: `docs/demo.gif` (≤ 8 MB) or link; `docs/screenshots/*.png`.

## Acceptance
All validators green; C7 passes; fresh-clone one-command scaffold test documented in `docs/fresh-machine-check.md` with the exact commands and expected output.
