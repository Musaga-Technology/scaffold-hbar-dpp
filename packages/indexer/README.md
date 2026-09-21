# @sh/indexer

Reads the Hedera mirror node, replays each product's HCS event log into a local
database, and reconciles custody claims against real NFT transfers.

```bash
yarn indexer:dev      # poll the mirror node and serve the read-only index API
yarn indexer:replay   # drop the index and rebuild it from sequence 1
yarn indexer:verify   # replay into a temp index, diff against the live one
yarn indexer:test     # unit tests against recorded mirror-node fixtures
```

Configuration is environment-only — see `.env.example`. The indexer never needs
an operator key: it only reads. `yarn passport:bootstrap` writes `.env.local`
with the registry address and the demo product's topic id.

## Why an indexer at all

HCS records what happened so it can be trusted later; it is not a database. The
browser never reads HCS. Reads come from this index, which is rebuildable from
the mirror node at any time — `yarn indexer:replay` proves it, and
`yarn indexer:verify` proves the live index matches a clean replay.
