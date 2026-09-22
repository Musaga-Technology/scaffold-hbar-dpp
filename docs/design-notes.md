# Design notes

Why this template is built the way it is.

None of this is needed to *use* the template — the [README](../README.md) covers
that in five minutes. This is for the reader who wants to know why the design
made a particular choice, or who is about to change one and should know what it
was protecting.

## Why HCS plus an index, and not HCS as a database

An HCS topic is an append-only, consensus-ordered log. It is excellent at proving that something was claimed at a particular moment, and bad at answering "show me every battery from plant 2 with a failed inspection". Submitting a message also costs about $0.0008, so a topic is not a place to put documents.

So this template splits the job:

| Concern | Where it lives | Why |
| --- | --- | --- |
| What happened, in what order | HCS topic, one per product | Consensus timestamps are the proof |
| Who holds the product now | HTS NFT custody | The network's own answer, not a claim |
| Answering queries | Indexer database | Rebuildable from the mirror node at any time |
| Large content | Off-chain, content-addressed | HCS messages are capped at 1024 bytes here |
| Documents still being what was attested | Indexer re-fetches and re-hashes each CID | A pinned file nobody checks proves nothing |

The two truth sources are deliberately reconciled rather than merged. For every custody claim on HCS, the indexer checks the NFT's real transfer history on the mirror node. A claim with no matching transfer is surfaced as a **discrepancy**, never hidden. `yarn indexer:verify` replays the whole log into a temporary index and diffs it against the live one _(increment 02)_.


## Documents, and why storage is load-bearing here

A Digital Product Passport is mostly documents. The EU battery regulation does
not ask for a timeline of shipping events — it asks for a conformity
declaration, a carbon-footprint statement, test reports, an end-of-life record.
Those are the regulatory payload, and none of them can go on HCS: a topic is a
log, capped at 1024 bytes in this template because messages cost money and a
ledger is not a filing cabinet.

So the topic carries a *reference*. The obvious reference is a URL, and a URL is
worthless for this purpose. It is a promise that some server will still be there
in 2034 and will still be serving the same bytes. Nothing checks either claim.

This template references documents by **CID**, so the address and the integrity
proof are the same value:

```json
"payload": {
  "result": "pass",
  "inspector": "Example Test Laboratory",
  "attachments": [
    {
      "cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "hash": "9f86d081884c7d65…",
      "name": "conformity-certificate.pdf",
      "type": "application/pdf"
    }
  ]
}
```

Two things follow, and both matter.

**The reference cannot be edited after the fact.** Attachments live inside
`payload`, so `payloadHash` covers them. Change the CID and the event's own hash
stops matching, and the indexer reports it exactly as it reports a forged
custody claim.

**The content is checked, not assumed — and no gateway is trusted to do it.**
Pinning a certificate is easy and almost nobody verifies it afterwards. The
obvious check — fetch the file from a gateway and hash it — has a hole: it
trusts the gateway to have fetched the right thing. At that point the CID is a
URL with extra steps, and swapping `ipfs.io` for an S3 bucket would change
nothing.

So the indexer asks gateways for a
[CAR](https://ipld.io/specs/transport/car/) instead
(`/ipfs/<cid>?format=car&dag-scope=entity`, the
[trustless gateway](https://specs.ipfs.tech/http-gateways/trustless-gateway/)
spec). Every block is hashed and checked against its own CID, the DAG must be
rooted at the CID the event committed to, and the document is rebuilt only from
blocks that passed. Then its sha256 is compared with the one on HCS. The code is
`packages/indexer/src/content/ipfs.ts`, about 300 lines on `@ipld/car` and the
UnixFS exporter.

That changes what each verdict can mean:

| State | Meaning |
| --- | --- |
| `verified` | The document the CID names is the one whose hash was attested. |
| `mismatch` | The CID names a *different* document from the one whose hash was committed. |
| `unreachable` | No gateway served a copy that checked out. **Not** evidence the content is wrong. |
| `pending` | Not checked yet. |

A `mismatch` is **not** "the certificate was replaced later". Content behind a
CID cannot change — that is the point of a CID. What it means is that the
attestation contradicts itself: the issuer committed the address of one
document and the hash of another. It was wrong from the moment it was written.
That is fraud-shaped, and it downgrades the whole passport to `discrepancy`.

A gateway that serves altered blocks cannot produce a `mismatch`, because
nothing it serves is used until it checks out. It is caught, skipped in favour
of the next gateway, and named in the note. If every gateway fails, the verdict
is `unreachable`, which downgrades nothing — a gateway having a bad day is not
fraud, and a tool that cried wolf about it would train people to ignore the
badge that matters.

Two public gateways are used by default, `trustless-gateway.link` and
`gateway.pinata.cloud`, run by different operators. Because neither is trusted,
the second one is only for availability, never a second opinion. Add your own
Kubo node with `IPFS_GATEWAY_URL`.

The bundled demo shows both outcomes. Serial 1 has a certificate that verifies.
Serial 2's issuer linked the lab's real fibre report (41% recycled) but
committed the hash of a better-looking version (68%) that was never published.
Its CID is a raw CID, so its multihash *is* the sha256 of the document it names,
and the contradiction can be read off the reference itself without fetching
anything.

**The address is computed, not reported.** The upload route computes each
document's CID from its bytes before uploading, and refuses to attest if the
pinning service reports a different one. CIDs are computed with Kubo's CIDv1
defaults — raw leaves, 256 KiB chunks — which Pinata documents as its own.
Conformance vectors in `packages/indexer/test/ipfs.test.ts` pin this against
CIDs produced by Kubo 0.43.1 at every chunk boundary.

**What this does not prove.** That a document says what it claims to say. It
proves only that the document is the one attested at that consensus timestamp.
That is a narrow guarantee and the UI states it narrowly.

### Token metadata is content-addressed too

The bytes stored on an HTS serial are the only pointer a wallet or an explorer
has to what the token *is*. Pointing them at the issuer's own web app — which is
what most templates do, and what this one did first — makes every passport's
identity depend on that app still being online. That is a strange property for a
record meant to outlive the product and a worse one for a record meant to
outlive the company.

So `registerProduct` stores `ipfs://<cid>` when a storage provider is
configured, and the HIP-412 document is pinned before the mint that references
it. `yarn passport:status` reports which of the two a serial got:

```
  ok    metadata    ipfs://bafybeigdyrz…  (content-addressed)
  unset metadata    http://localhost:3000/api/passport/metadata/0.0.6666666666  (served by the app — set PINATA_JWT to pin it instead)
```

HIP-412 metadata is immutable for the life of a serial, so the pinned document
is a snapshot taken at registration. Everything that changes afterwards —
custody, events, verification status — lives on the verify page, which reads the
index. They are not competing copies of the same thing.

The registry caps that pointer at 100 bytes. An `ipfs://` URI is about 60 and
fits; a long hosted URL may not, which is a quiet second argument for content
addressing. Both mint paths check before spending gas.

### Configuring it

Set `PINATA_JWT` in `packages/nextjs/.env.local`; a free key is enough for
testnet. Without it, attaching a document returns `503` with instructions and
every other part of the template is unaffected — verification, custody,
reconciliation and the public page all work with no storage configured at all.

### IPFS or Arweave

Both are supported, and a passport can carry documents on both at once; the
bundled demo does exactly that. Verification is **not** equally strong, and
the notes say so. An IPFS CID is a hash of the content, so the indexer checks
the gateway's answer itself. An Arweave transaction id is not, so the indexer
has to trust the gateway to return that transaction's data. The sha256 on HCS
still binds the content, but on Arweave a `mismatch` could also mean a
dishonest gateway, and the verdict's note does not pretend otherwise.

The difference that matters is persistence, not decentralisation:

| | IPFS | Arweave |
| --- | --- | --- |
| Content survives | while somebody keeps paying to pin it | paid once, stored by endowment |
| Cost | free tiers are generous | free under 100 kB on Irys mainnet; devnet free but pruned after ~60 days |
| Configure with | `PINATA_JWT` | `ARWEAVE_JWK` (takes precedence when both are set) |

That first row is the whole argument. A passport for an EV battery has to still
resolve in fifteen or twenty years, quite possibly after the manufacturer has
stopped paying for anything. **Pin rot is already visible in this template** —
an attachment whose pin has lapsed shows as `unreachable`, the reference still
valid and the content gone. Arweave is the answer to that state rather than a
second flavour of the same thing.

The Arweave path needs `@irys/sdk`, which is deliberately *not* a dependency:

```bash
yarn workspace @sh/nextjs add @irys/sdk
```

Teams using IPFS should not install an Arweave SDK they will never call, and the
install is already large enough. The provider says so at runtime if it is missing.

Both sit behind one interface in `packages/nextjs/services/storage/` — one
method, `put`. Filebase, web3.storage or a self-hosted IPFS node are the same
shape; see `AGENTS.md`.


## Sustainability claims, and where this template stops

Two of the battery category's fields are environmental: `carbonFootprintKgPerKwh`
and `recycledContentPct`. The event types include `product.repaired` and
`product.recycled`. That makes this a reasonable starting point for a
circularity or compliance product, and adding a category is one JSON file.

Be clear about what is verified, though. This template proves that **a document
is the one that was attested** at a given consensus timestamp, and that a
custody claim matches the ledger. It does **not** prove that a number is true.
An issuer who types `carbonFootprintKgPerKwh: 41.2` gets that figure faithfully
recorded, hashed and timestamped — a provenance guarantee, not a measurement
one. The UI states the narrow version on purpose, and anything built on top
should keep doing so.

What is missing for a serious sustainability product is an attestation of the
*figures*: who measured them, under which methodology, and with what evidence.

### Guardian

[Guardian](https://github.com/hashgraph/guardian) is Hedera's open-source
policy and dMRV engine, built for exactly that gap: methodologies, verifiable
credentials, and the issuance of environmental assets. It is the natural layer
above this template, not a competitor to it — Guardian attests the numbers, a
passport carries the product's identity, history and documents.

The two fit together on the wire, and it is worth knowing how before designing
an integration. Checked against testnet in September 2026:

- Guardian anchors its artefacts on HCS. Its testnet registry topic is
  `0.0.1960`, and each standard registry announces its own topic there.
- A registry topic carries `DID-Document`, `Schema`, `VC-Document`,
  `Guardian-Role-Document` and `Policy` messages. Each document message carries
  `cid` and `uri` (`ipfs://…`) alongside the issuer DID and a `relationships`
  chain — the same "reference by content address" shape this template uses, and
  readable from the same mirror node.
- Our event schema already accepts `did:hedera:…` as an actor, and the
  attachment model already verifies CIDv0 (`Qm…`), which is what Guardian
  writes. So a Guardian VC can be referenced from a passport event today, with
  no change to the schema.

One caveat, found by trying it rather than assuming: **Guardian's own documents
are usually not retrievable from public IPFS gateways.** Guardian pins through
Filebase, and fetching four testnet VC and DID document CIDs returned timeouts
from Filebase and Pinata, 429 from ipfs.io and dweb.link, and 520 for a
verifiable CAR request. The indexer would report those as `unreachable`, which
is the honest verdict: the reference is sound and the content could not be read.
A deployment that pins its Guardian documents to a public gateway does not have
this problem, and the existing verifier checks them with no changes.

That is why there is no Guardian adapter in this template. Referencing a
Guardian credential needs no code, and verifying its content needs the
publisher to make it retrievable — something a template cannot decide for you.

## Getting a passport to the person who bought the product

A passport that only the issuer can hold is a database with extra steps. The
point is that the buyer ends up holding the record of the thing they bought.

On Hedera that normally runs into token association: a receiver must associate a
token before they can hold it, which means asking a consumer to perform a
blockchain operation before you can give them anything. **HIP-904 removes that
step**, and it is the reason this journey works:

```
POST /api/passport/airdrop   { tokenId, serial, receiver }
```

The receiver can be a `0.0.x` account id or an EVM address that already has an
account. Two outcomes, and the app reports them differently because they mean
different things:

| Outcome | What it means |
| --- | --- |
| **Delivered** | The receiver had an automatic-association slot free. They hold the passport now. |
| **Pending** | Parked as a pending airdrop. They hold **nothing** until they claim it. |

Collapsing those into one tick would tell an issuer their customer has something
when they do not.

**Claiming happens in the consumer's wallet, not here.** A claim must be signed
by the receiver's own key; this app holds an operator key, which is a different
account. `/my-passports` shows what is waiting and links each one to its
passport page so it can be inspected *before* being accepted — but the claim
itself belongs to HashPack, Blade, or whatever the consumer uses.

There is a second path on the contract. `airdropPassport` performs a direct
`transferNFT` from the registry treasury, which is simpler but requires the
receiver to already be associated. It exists as the documented fallback for
networks where HIP-904 is unavailable.

