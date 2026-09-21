# Increment 02 — HCS event layer and the indexer (with reconciliation)

## Goal
Implement the write side (server routes that submit compact typed events to a product's HCS topic) and the read side (indexer that replays mirror-node data into SQLite and reconciles custody). This increment is the heart of the template; quality here matters more than UI polish.

## Preserve
Everything from 01. Do not change the contract ABI.

## Deliver — packages/nextjs (server only)
1. `services/hederaClient.ts` (port of the hedera-demo pattern: operator from `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_PRIVATE_KEY` / `HEDERA_NETWORK`; `hasOperatorKey()`), `services/mirrorNode.ts` (typed `fetchTopicMessages`, `fetchNftTransactions`, `fetchContractLogs`).
2. `lib/events.ts`: TypeScript types generated from `schemas/passport-event.schema.json`, `canonicalize(payload)` (sorted keys, no whitespace), `sha256Hex`, `buildEvent({type, serial, tokenId, actor, payload, ref})` enforcing ≤ 1024 bytes serialized; event type registry with built-ins: `product.registered`, `product.shipped`, `custody.transferred`, `product.inspected`, `product.repaired`, `product.recycled`, `custom.*`.
3. Routes under `app/api/passport/`:
   - `POST topics` — create topic for `{tokenId, serial}` (memo `passport:{tokenId}:{serial}`, submit key = operator). 503 with a friendly error when operator missing.
   - `POST events` — validate with the JSON schema (ajv), build event, submit via `TopicMessageSubmitTransaction`, return `{transactionId, sequenceNumber?}`. Reject payloads > 1024 bytes and any `payload` field named `data`, `file`, `image` with base64 content (explicit anti-pattern guard, tested).
   - `GET products`, `GET products/[serial]`, `GET products/[serial]/events`, `GET stats` — read from the index (see 4) or from `fixtures/` when `PASSPORT_DATA_SOURCE=fixtures` or no index DB exists. Never read HCS directly.
4. Index access from the app: `lib/indexClient.ts` reads the SQLite file produced by the indexer (`INDEX_DB_PATH`, default `../indexer/data/passport.db`) with better-sqlite3 or, if `INDEX_API_URL` is set, proxies to the indexer HTTP API.

## Deliver — packages/indexer
1. Stack: TypeScript, Drizzle ORM, SQLite (`better-sqlite3`) default, Postgres when `DATABASE_URL` set; Vitest.
2. Schema: `products` (serial, token_id, topic_id, product_hash, issuer, category, name, metadata_json, current_holder, status, last_reconciled_at), `events` (id, serial, topic_id, sequence_number, consensus_timestamp, type, actor, payload_json, payload_hash, ref, hash_valid, reconciliation: `n/a|reconciled|discrepancy|pending`, reconciliation_note), `cursors` (topic_id, last_sequence_number), `nft_transfers` (token_id, serial, consensus_timestamp, from, to, transaction_id).
3. `src/poller.ts`: for each topic in `INDEXER_TOPIC_IDS` (comma list) or discovered from `ProductRegistered` logs of `PASSPORT_REGISTRY_ADDRESS` via mirror node contract results, page `GET /api/v1/topics/{id}/messages?sequencenumber=gt:{cursor}&limit=100&order=asc`, base64-decode, handle chunked messages, decode via `src/events/decode.ts` (unknown types → `custom.*`, invalid JSON → stored as `malformed` with raw bytes hash), recompute `payloadHash` and set `hash_valid`. Poll interval `INDEXER_POLL_MS` (default 5000). Idempotent upserts keyed by (topic_id, sequence_number).
4. `src/reconcile.ts`: for every `custody.transferred` and `product.registered` event, fetch `GET /api/v1/tokens/{tokenId}/nfts/{serial}/transactions`, match by `ref` transaction id or by (from,to) within ±10 minutes of consensus time; set `reconciled` / `discrepancy` with a human-readable note; compute product `status = verified|pending|discrepancy` and `current_holder` from mirror node (truth) not from HCS (claims).
5. CLI (`src/index.ts`): `dev` (poll loop + serve a tiny HTTP API on `INDEXER_PORT` with the same GET endpoints as the app), `replay` (drop DB, rebuild from sequence 1), `verify` (replay into a temp DB, diff against the live DB, print table of mismatches + reconciliation summary, exit 1 on mismatch).
6. Tests (≥ 8) using recorded mirror-node JSON fixtures in `test/fixtures/`: paging/cursor, chunked message reassembly, hash validation, unknown type handling, replay determinism (same fixtures → same DB rows twice), reconciliation happy path, forged custody → discrepancy, `verify` diff output.
7. Fixtures for the app: `packages/nextjs/fixtures/demo-passport.json` (serial 1, `verified`, ≥ 5 events) and `demo-passport-forged.json` (serial 2, `discrepancy`) generated from the same decoder so the shapes cannot drift.

## Non-goals
No page work beyond wiring the fixture data source; no DID; no HIP-991 fee topics (mention in README as an option for paid third-party attestations).

## Acceptance (deterministic)
All yarn.json commands pass. `yarn indexer:test` covers the list above. `GET /api/passport/products/1` returns the fixture passport when no DB exists.
