# Contributing

## Setup

Node 20.18.3 or later, with Corepack, which provides the pinned Yarn 3.2.3.

```bash
corepack enable
yarn install
```

Use `yarn` only. A `package-lock.json` or `pnpm-lock.yaml` fails the harness.

## Before you open a pull request

Run the gates CI runs. All of them pass with no `.env`, no keys and no network
beyond the install:

```bash
yarn lint
yarn next:check-types
yarn indexer:check-types
yarn hardhat:compile
yarn hardhat:test
yarn indexer:test
yarn next:build
```

If you changed anything a browser sees, also boot the app with no configuration
and run the browser smoke test. It fails on missing content, any console error,
and any browser request that reads HCS directly:

```bash
yarn next:serve        # after yarn next:build, in another terminal
yarn smoke
```

CI repeats all of this inside a project scaffolded from your commit through the
real CLI, on Node 20.18.3 (`.github/workflows/fresh-scaffold.yml`).

**If your change sends a transaction, try it once on Hedera testnet with a real
wallet.** Every test in this repository passed while the issuer page could not
register a product: a wallet estimate ran out of gas, a MetaMask session never
finished restoring, and a correct hand-over would have been flagged as a
forgery. None of that is visible without a signed transaction. Say in the pull
request what you ran and what the mirror node showed.

## Rules that are easy to break

The full list, with the reason for each, is in [AGENTS.md](AGENTS.md). The ones
a change most often trips over:

- The browser never reads HCS. Topic reads go in a server route.
- An IPFS document is verified against its CID, never by hashing whatever a
  gateway returns.
- Writes through the HTS system contract set `gas` explicitly.
- Keys never get a `NEXT_PUBLIC_` prefix.
- `better-sqlite3` stays on 12.x while the floor is Node 20.

## Commits and docs

One change per commit. The message says why, not only what — `git log` shows
the house style.

When a command, environment variable or behaviour changes, update the README
and `docs/configuration.md` in the same pull request. Every claim in the README
is meant to be checkable; if you cannot check one, say so rather than state it.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md),
not in a public issue.
