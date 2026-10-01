# Security

This is a template for Hedera testnet. It has not been audited, and nothing in
it has been reviewed for mainnet value at risk. Read the known limitations below
before deploying anything built from it.

## Reporting a vulnerability

Use **Report a vulnerability** on this repository's Security tab, which opens a
private advisory visible only to the maintainers. Please do not open a public
issue for a security problem. Expect an acknowledgement within a week.

## Who holds what

| Part | Holds | Trusts |
| --- | --- | --- |
| Browser, public pages (`/`, `/verify/*`) | nothing — no key, no wallet code | the app server, for index data |
| Browser, issuer pages | the user's wallet, via MetaMask or WalletConnect | the app server |
| App server | the operator key (`HEDERA_OPERATOR_*`), the storage key (`PINATA_JWT` or `ARWEAVE_JWK`) | the mirror node, the registry contract |
| Indexer | no key — it only reads | the mirror node, for consensus data |
| Registry contract | the collection's treasury and supply key | its owner |
| Deployer key | encrypted keystore in `packages/hardhat/.env` | the password you chose |

Keys never reach the browser. The operator and storage variables have no
`NEXT_PUBLIC_` prefix, and the modules that read them import `server-only`, so
importing one from a client component fails the build rather than shipping the
key. `.env` files are gitignored, excluded from Docker images by
`.dockerignore`, and the harness fails the build if one is committed.

## What a verified passport proves

- **A document is the one attested.** IPFS documents are fetched as CARs from
  gateways that are not trusted; every block is checked against its CID and the
  rebuilt file against the sha256 committed on HCS. A gateway serving altered
  content is caught and skipped.
- **A custody claim matches a real transfer.** Each `custody.transferred` event
  is matched against the NFT's transfer history on the mirror node. A claim
  with no matching transfer is shown as a discrepancy.
- **An event has not been edited.** Each carries the sha256 of its own payload,
  and HCS orders and timestamps it by consensus.

It does **not** prove that a document's content is true, that a figure such as
a carbon footprint is accurate, or — given the first limitation below — who
asked the app to submit an event. It proves that the record has not changed
since it was attested, and when it was.

## Known limitations

**The server's write routes do not authenticate their caller.**
`POST /api/passport/topics`, `/events`, `/attachments` and `/airdrop` trust the
request. The events route checks the registry's `setEventLogger` allow-list
against the `actor` the request names, and nothing proves the caller controls
that address. Anyone who can reach a server holding operator credentials can
therefore log events in any allowed actor's name, create topics at the
operator's expense, pin files to the configured storage account, and airdrop
passports the operator holds. Run the app with operator credentials only where
nobody else can reach it — on your own machine — or add authentication, such as
a wallet signature verified on the server, before exposing it.

**The operator can write to every topic directly.** It holds each topic's submit
key, so the allow-list governs what this app submits, not what the key holder
can submit with any other tool. A deployment that needs per-logger guarantees
should give each logger its own submit key.

**The registry has a single owner.** It uses OpenZeppelin's `Ownable`: one key
can allow-list issuers and release passports from the treasury. On mainnet, make
the owner a multisig or a threshold key.

**The mirror node is trusted for ledger data.** The indexer believes what the
mirror node reports about consensus, transfers and topic messages.
`yarn indexer:verify` detects an index that has drifted from the mirror node;
it cannot detect a mirror node that lies. Point `MIRROR_NODE_URL` at one you run
if that matters.

**Arweave documents are checked less strictly than IPFS ones.** An Arweave
transaction id is not a content hash, so the gateway is trusted to return the
right data; the committed sha256 still binds the content, and the verdict says
what was trusted.

**Keyless bootstraps rely on a shared pin.** Without `PINATA_JWT`, the bootstrap
attaches a demo document by a CID the maintainers keep pinned. If that pin
lapses, those passports report the document as unreachable, which downgrades
nothing.

## Safeguards built in

- The bootstrap refuses to deploy with the public Hardhat test account, whose
  key is published in every Hardhat tutorial and which is funded on Hedera
  testnet by someone else's accident.
- Uploads compute each document's CID locally and refuse a storage provider
  that reports a different one.
- A custody claim is resolved to `0.0.x` account ids before it is submitted, so
  it is compared against the ledger in the ledger's own terms.
- The status endpoints report whether credentials are configured, and which
  variable is wrong, without returning any part of a value.
