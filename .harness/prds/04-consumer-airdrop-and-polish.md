# Increment 04 — Consumer airdrop & claim, /my-passports, docs, template polish

## Goal
Finish J5–J6, make the template feel finished, and make the README the best HCS+HTS explainer in the ecosystem.

## Deliver
0. **Hosting, made trivial (never required by validators).**

   *Revised from the original brief.* This template is two processes: the app and
   a long-running indexer with a database. A serverless host can run the first
   and not the second, so a Vercel-first hosting story describes half the system.
   Self-hosting leads; Vercel stays as a one-click preview of the public page,
   labelled as such.

   - `packages/nextjs/Dockerfile` (multi-stage, Node 20 slim, non-root) built on
     Next's `output: "standalone"`, and `packages/indexer/Dockerfile` (same
     shape). Root `docker-compose.yml` bringing up `app` + `indexer` +
     `postgres`, with `DATABASE_URL` wired and the app pointed at the indexer via
     `INDEX_API_URL`. `docker compose up` must run the whole system on any
     container host, vendor-neutral. `yarn indexer:dev` stays the zero-setup
     SQLite path for local work.
   - Keep `packages/nextjs/vercel.json` (already in the seed — verify) and a
     "Deploy with Vercel" button in the README, presented as a preview of the
     public verify page only. The deployed preview must render the fixture
     passport with zero env so a first deploy is never broken, and the README
     must say plainly that the indexer needs a host that can run a process, and
     that this is a property of serverless platforms generally rather than of
     Vercel specifically.
   - README section "Running it somewhere other than your laptop": Docker Compose
     first, then Fly.io / Railway / Render / ECS notes (the indexer is a plain
     container; `fly.toml` included), then the one-click preview.
   - A GitHub Actions `deploy-check.yml` that only builds the Docker images (no
     push, no secrets) so neither Dockerfile can rot.
   - `yarn passport:status` surfaced in README troubleshooting as the first thing
     to run when something looks wrong.
1. Airdrop: on `/issuer/[serial]`, "Send to consumer" form accepting `0.0.x` or an EVM address; two paths behind `NEXT_PUBLIC_AIRDROP_MODE`: `contract` (write `airdropPassport`) and `operator` (POST `/api/passport/airdrop` using `TokenAirdropTransaction` with the hedera-demo `TransferTransaction` fallback — only valid when the operator account is the holder). Emit `custody.transferred` event with `ref`. Document HIP-904 semantics: pending airdrop until claimed unless receiver has unlimited auto-associations.
2. `/my-passports`: wallet gate; list held serials via mirror node `GET /api/v1/accounts/{id}/nfts?token.id=` (through a server route), plus pending airdrops via `GET /api/v1/accounts/{id}/pending-airdrops` with a "Claim" action (server route `claimAirdrop` is impossible without the receiver's key — so implement claim via wallet using the HTS system contract `claimAirdrops` if the interface supports it, otherwise show instructions + HashPack deep link). Each entry links to `/verify/[serial]`.
3. `README.md` (final): badges; one-paragraph pitch; **"From zero to a live passport in 5 commands"** block at the very top; "Why HCS + an index (and why not HCS as a database)" with the fee note; architecture diagram (Mermaid); quick start (fixtures → testnet); the six journeys with screenshots/GIF; commands table; event schema summary; extension guide (new category, new event type, Postgres, custom reconciliation rule); DPP/GS1 context and disclaimers; troubleshooting (unfunded account, token-creation fee, ECDSA vs ED25519, mirror node lag, chunked messages); security notes (operator key server-only; what never goes on HCS); license.
4. `AGENTS.md` (final): repo map, invariants (compact events, reads from index only, no secrets, yarn only), how to add category/event type, how reconciliation decides, validators the harness runs, style rules for Hedera terms.
5. `template.json` outro verified against real CLI behaviour (`{run:...}` placeholders).
6. Lint/format clean; `yarn hardhat:test` and `yarn indexer:test` counts reported in README; CI workflow `.github/workflows/ci.yml` running the yarn.json commands on Node 20.
7. Demo assets: `docs/demo.gif` (≤ 8 MB) or link; `docs/screenshots/*.png`.

## Acceptance
All validators green; C7 passes; fresh-clone one-command scaffold test documented in `docs/fresh-machine-check.md` with the exact commands and expected output.
