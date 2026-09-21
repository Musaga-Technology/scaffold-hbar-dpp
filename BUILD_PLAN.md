# Build plan — 15 Sep → 4 Oct 2026

| Dates | Work | Exit criteria |
|---|---|---|
| Sep 15–20 (pre-window) | Register. Read the emailed brief; re-score against the rubric. Create org/repo (empty). Study `templates/tokenize-subscriptions` + `templates/hedera-demo` + Harness docs. Confirm HTS `airdropTokens` signature in `hts-system-contract` skill. Fund an ECDSA testnet account. Do NOT commit template code before the 21st unless the brief allows. | Brief understood; seed + kit ready locally |
| Sep 21–23 | Increment 01 (workspace shape, contract, tests, bootstrap). | 01 acceptance green; contract deployed to testnet once |
| Sep 24–27 | Increment 02 (routes, indexer, reconciliation, fixtures). | `yarn indexer:verify` green on real bootstrap data; forged fixture → discrepancy |
| Sep 28–30 | Increment 03 (UI). Attend AMA Sep 29 10:00 ET — ask how integrations are scored and whether Harness Tier 3 artifacts count. Decide on increment 05. | C1–C6 pass |
| Oct 1–2 | Increment 04 (airdrop/claim, README, AGENTS, CI, demo GIF). Optional 05. | All validators green; harness run report saved |
| Oct 3 | Fresh-machine scaffold test; fix outro; write `docs/fresh-machine-check.md`. | One-command scaffold verified by a second person/machine |
| Oct 4 | Buffer + submit (deadline 11:59 PM ET). | Submitted |

Risk register: HTS system-contract signatures (verify against skill docs before coding; keep MockHTS in sync) · token-creation fee sizing (`msg.value` too low reverts; document 20–30 HBAR) · mirror node lag (poll + "pending" state, never assume immediate) · HCS chunking for messages > 1024 bytes (we forbid > 1024, but decode chunks anyway) · burner connector must remain enabled for Tier 3.5 · Yarn/Node versions on the judge's machine (pin `packageManager`, `engines`).
