# Fresh-machine check

What was actually run against a clean scaffold, and what it produced. Every
figure here comes from a real run, not an estimate.

Re-run this whenever the template changes in a way that could affect setup —
a new dependency, a changed script, a new required environment variable.

## Method

Scaffolded through the real CLI from the published repository, with no local
seam and no reuse of this working copy:

```bash
npm create scaffold-hbar@latest my-passports -- \
  --template Musaga-Technology/scaffold-hbar-dpp \
  --frontend nextjs-app --solidity-framework hardhat \
  --network testnet --package-manager yarn
```

## Results

**Last full run 28 September 2026**, scaffolded fresh from GitHub through the
real CLI · **Host:** macOS 13.7 on Intel, Node v22.19.0, Yarn 3.2.3. The CI
gates were also replayed under Node 20.20.2, the version CI uses — see below.

| Step | Result |
| --- | --- |
| Scaffold from GitHub, including install | clean, 10m 47s end to end, dependency install included |
| `yarn install` alone | 3m 11s cold, 2m 23s warm cache (measured 21 September) |
| `yarn lint` | clean, all three workspaces |
| `yarn next:check-types` | clean |
| `yarn indexer:check-types` | clean |
| `yarn hardhat:compile` | 7 contracts |
| `yarn hardhat:test` | 93 passing, 4 pending (the opt-in fork suite) |
| `yarn hardhat:test:forking` | 97 passing, in about 4 minutes |
| `yarn indexer:test` | 178 passing |
| `yarn next:build` | clean |
| Boot with no `.env` | `/`, `/verify/1`, `/verify/2`, `/issuer`, `/my-passports`, `/api/passport/products` all 200 |
| First passport after `yarn next:start` | 31 s, dev mode |
| First visit to `/issuer` in dev mode | 92 s to compile the wallet stack (about 21,500 modules), once; 0.4 s after. Considerably longer when the machine is under load |
| Demo passport renders | yes — `/verify/2` shows its discrepancy and a document that does not match its attestation |
| `npx hedera-harness validate` | passed, 0 findings, Tier 2 green on 6 routes |

Disk footprint after install:

```
packages/nextjs/node_modules    1.7 GB
packages/hardhat/node_modules   707 MB
packages/indexer/node_modules   198 MB
```

About 2.6 GB. Most of it is toolchain inherited from scaffold-hbar rather than
added by this template, and none of it is needed to *run* the system —
`docker compose up` requires Docker alone.

## What the scaffold does not include

The CLI deletes `template.json` after reading it, which is correct: it is a
manifest for the scaffolding process, not part of the application. It stays in
the repository, where the CLI fetches it from.

These are in the repository but deliberately excluded from what a scaffolded
project receives, because they describe how this template was built rather than
how to use it: the build plan, the original product brief, research notes and
the agent kickoff prompt.

## Testnet run

Registry `0xCBc3089cb39ef55114341Ff1aB9BFeA5f22D5a7A`, collection
`0.0.10649382`, on Hedera testnet, from a funded ECDSA account.

| Serial | Made | What it proved |
| --- | --- | --- |
| 1 | 21 September, `yarn passport:bootstrap` | The command-line path: deploy, collection, topic, mint, three events. `/verify/1` rendered **verified**; all three payload hashes recomputed from mirror node data matched. |
| 2 | 22 September, `yarn passport:new-product` | Pinned HIP-412 metadata and a document attached by the bootstrap, verified against its CID. |
| 3 | 29–30 September, **the issuer page with MetaMask** | The whole UI lifecycle: registered, shipped, inspected with a report attached, handed over. The indexer reports the passport verified, the hand-over **reconciled** against the real NFT transfer, and the report verified against its CID with no gateway trusted. |

Serial 3 is the one the README links to. It is also the run that found the
issuer page had never worked with a real wallet: a hanging MetaMask session
restore, a gas estimate that ran out, topics orphaned by failed attempts,
hand-over buttons that could not move a new passport, and hand-over claims
that could never have matched. Each is fixed; the tests and the harness had
passed throughout.

Links are in the [README](../README.md#proof-it-runs-on-hedera-testnet).

## On Node 20

The brief sets the floor at Node 20.18.3, and CI and both Dockerfiles run Node
20. Until 28 September the ci workflow was failing there while every local run
passed on Node 22: `better-sqlite3` 13 requires Node 22, so the four indexer
test files that open a store crashed with "Worker exited unexpectedly". It is
now pinned to 12.x, which supports Node 20 through 26.

Replayed in a clean checkout, with the CI workflow's steps in its order:

| Node | Result |
| --- | --- |
| 20.20.2 — what `actions/setup-node` resolves `20` to | install, lint, both type checks, compile, 93 hardhat, 178 indexer, `next:build` — all pass |
| 20.18.3 — the floor | SQLite driver rebuilt for it and loads; 178 indexer tests pass |
| 22.19.0 — this machine | everything above |

## Known rough edges

- **The first wallet page is slow to compile in dev mode.** `/issuer` and
  `/my-passports` pull in RainbowKit and wagmi's connectors, which bring Base
  Account, Coinbase's SDK and Reown AppKit with them. That is inherited from
  scaffold-hbar and is not something this template can trim without replacing
  its wallet layer. Two fixes were measured and rejected: dropping the
  inherited `snapshot.managedPaths` override was no faster, and Turbopack
  cannot parse `globals.css`. `yarn next:build && yarn next:serve` avoids the
  wait entirely.

- **`packages/hardhat/.env` fails `hedera-harness validate`.** Expected and
  local-only. The file appears once you run `account:generate` or
  `account:import`, is gitignored, never committed, and holds an encrypted
  keystore rather than a raw key. A fresh clone validates clean.
- **Playwright's own Chromium does not install on macOS 13.** The screenshot
  script and the harness's browser gate both drive the system Chrome instead.
  `PLAYWRIGHT_CHANNEL=bundled yarn screenshots` uses a managed browser where one
  is available.
- **The forking plugin cannot emulate NFT minting.** `@hashgraph/system-contracts-forking`
  0.1.2 rejects `mintToken(token, 0, metadata[])`, which is why `MockHTS.sol`
  exists. The fork suite asserts that limitation rather than skipping it, so the
  test fails and asks for wider coverage if the plugin ever gains support.
