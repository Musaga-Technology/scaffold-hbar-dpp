# Increment 05 (STRETCH — only if 01–04 are green by 30 Sep) — Supplier attestations with did:hedera

## Goal
Let third parties (inspectors, recyclers, certifiers) sign events with a `did:hedera` identity so the verify page can show *who* attested, resolvable on-chain.

## Deliver
1. `packages/nextjs/lib/did.ts` using `@hiero-did-sdk-js` (hiero-ledger): create a DID for the operator (`yarn passport:did:create`), resolve DIDs, sign event `payloadHash` with the DID key → `sig` and `actorDid` fields (already allowed by the schema).
2. Indexer: verify `sig` against the resolved DID document; store `attestation_valid`.
3. Verify page: "Attested by did:hedera:… ✔" chip per event; resolver link.
4. README section "Attestations and verifiable credentials" with a pointer to AnonCreds support in the DID SDK for full VC flows.

## Non-goals
Full verifiable-credential issuance/presentation; wallet-based DID key management.
