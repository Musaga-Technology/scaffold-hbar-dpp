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

**Date:** 21–22 September 2026 · **Host:** macOS 13.7, Node v22.19.0, Yarn 3.2.3

| Step | Result |
| --- | --- |
| Scaffold from GitHub | clean |
| `yarn install` | 3m 11s cold, 2m 23s warm cache |
| `yarn lint` | clean, all three workspaces |
| `yarn next:check-types` | clean |
| `yarn indexer:check-types` | clean |
| `yarn hardhat:compile` | 7 contracts |
| `yarn hardhat:test` | 76 passing, 4 pending (the opt-in fork suite) |
| `yarn hardhat:test:forking` | 80 passing |
| `yarn indexer:test` | 145 passing |
| `yarn next:build` | clean |
| Boot with no `.env` | `/`, `/verify/1`, `/verify/2`, `/issuer`, `/my-passports`, `/api/passport/products` all 200 |
| Demo passport renders | yes — `/verify/2` shows its discrepancy and replaced document |
| `npx hedera-harness validate` | passed, 0 findings, Tier 2 green on 6 routes |

Disk footprint after install:

```
packages/nextjs/node_modules    1.7 GB
packages/hardhat/node_modules   707 MB
packages/indexer/node_modules   181 MB
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

Bootstrapped against Hedera testnet on 21 September 2026 from a funded ECDSA
account. Registry `0xCBc3089cb39ef55114341Ff1aB9BFeA5f22D5a7A`, collection
`0.0.10649382`, serial 1, topic `0.0.10649383`.

The indexer read all three lifecycle messages, reconciled the registration
against the mint, and `/verify/1` rendered as **verified** with HashScan links
to the real entities. All three payload hashes were independently recomputed
from mirror node data and matched what was committed on HCS.

Links are in the [README](../README.md#proof-it-runs-on-hedera-testnet).

## Known rough edges

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
