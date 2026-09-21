# Increment 03 — UI: public verify page, issuer dashboard, event logging, custody transfer

## Goal
Deliver the journeys J1–J4 from PRD.md on top of increments 01–02 using scaffold-hbar UI conventions (DaisyUI, `useScaffoldReadContract` / `useScaffoldWriteContract`, RainbowKit, notifications).

## Deliver
1. `/` — hero explaining passports in two sentences, registry stats from `/api/passport/stats`, serial search box → `/verify/[serial]`, "Open demo passport" link, network indicator.
2. `/verify/[serial]` — server component reading the index client. Sections: header (name, category badge, manufacturer, serial), identifiers card (token id, serial, topic id, registry address — each with HashScan link), **status badge** (`verified` green / `pending` amber / `discrepancy` red with note), timeline (ordered by consensus timestamp; each row: icon per type, type label, actor short form, payload summary rendered from the category schema's `display` hints, consensus time absolute + relative, HashScan link to the topic message and, for custody, to the NFT transaction; discrepancy rows highlighted with the reconciliation note), QR panel (`qrcode.react`) with the GS1 Digital Link URL when GTIN present else `/verify/{serial}`, copy button, and a "Demo data" banner when the fixture source is active. Must render with no wallet and no env.
3. `/issuer` — wallet gate; list products where connected address is issuer (from index); **Register product** form generated from the selected category schema (`schemas/categories/*.json`: fields, types, required, `display`); on submit: POST `/api/passport/topics` → `registerProduct` write via scaffold hook (metadata bytes = URL to `/api/passport/metadata/[serial]` HIP-412 JSON or inline data URI per `NEXT_PUBLIC_METADATA_MODE`) → POST `/api/passport/events` `product.registered` with `ref` = mint tx id → success card with ids + QR + link. Handle: operator missing (show setup instructions), collection not created (button to call `createCollection` with fee), wallet not issuer (explain `setIssuer`).
4. `/issuer/[serial]` — event log form (type select from registry + schema-driven payload fields + optional attachment URL/CID whose hash is computed client-side and stored as `payload.attachmentHash`), custody transfer form (`transferCustody` write, then `custody.transferred` event with `ref` = tx hash), event history (from index) with pending indicator until the indexer catches up.
5. Shared: `components/passport/*` (StatusBadge, Timeline, IdentifierCard, QrPanel, SchemaForm, EventTypeIcon), `hooks/usePassport.ts`, `hooks/useRegisterProduct.ts`, `hooks/useLogEvent.ts`.
6. Copy rules: "HBAR" uppercase singular; "Hedera testnet" lowercase; never claim "verified" for `pending`.

## Non-goals
Airdrop/claim UI (04). Mobile polish beyond responsive DaisyUI defaults.

## Acceptance
Tier 2 smoke routes render; C1–C4 of the acceptance contract pass against fixtures; C5–C6 pass with a funded operator + burner wallet.
