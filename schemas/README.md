# Schemas

- `passport-event.schema.json` — the HCS message format. Every message on a product topic must validate against it and serialize to ≤ 1024 bytes. Consensus timestamp (assigned by Hedera) is the authoritative time; `ts` is advisory.
- `categories/*.json` — product categories. Each drives the issuer form, validation, and how the verify page renders highlights. Add a category by adding a file; the app discovers it at build time.

Rules: only hashes and references for anything large (PDF, image, dataset); never put personal data on HCS; unknown event `type`s are accepted as `custom.*` and stored, not rejected.
