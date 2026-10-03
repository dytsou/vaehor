# Scheduled upload review residuals

Source context: LFG review run `20261002-050003-758ef969`, PR [#68](https://github.com/dytsou/vaehor/pull/68), branch `feat/scheduled-drive-upload`. The review compared `28621b08342be8adf5fefe2f72e0d61aa82023b3` with `origin/trunk` at `86dbef1a74ac1cb4195915a8521dce0a8aa3491f`. Review fixes were applied in commit `ad7ebc58` (`fix(review): apply review findings`).

GitHub Issues are disabled for `dytsou/vaehor` (`hasIssuesEnabled: false`), and no other project tracker is configured. The findings below therefore have no tracker ticket; this committed file is their durable handoff.

## Residual Review Findings

- **P2 — `docs/api/spec/modules/scheduled-uploads/operations.tsp:18` — Alert list omits its documented 400 response.** The runtime route returns HTTP 400 for an unsupported alert status, while the TypeSpec/OpenAPI contract declares only 200 and 401. The suggested follow-up is to add the shared bad-request response and regenerate OpenAPI and SDK types. No issue was filed because GitHub Issues are disabled and no alternate tracker is configured.
- **P2 — `lib/storage/private-scheduled-uploads.ts:498` — Full-file verification can overrun worker tick budget.** Pre-release verification hashes the full staged file in one worker claim, although files can be as large as 5 GiB and the worker tick budget is 7 seconds. The suggested follow-up is resumable, persisted hash verification that yields between bounded chunks while preserving the integrity gate before the first Drive write. This needs state/schema design, so it was not applied mechanically. No issue was filed because GitHub Issues are disabled and no alternate tracker is configured.

## Residual Risks

- **P2 — `lib/services/scheduled-upload-worker.ts:208` — Bound access-token acquisition in worker ticks.** A single reliability reviewer identified that OAuth or service-account token acquisition can stall before the Drive request timeout. This was retained as a soft-bucket risk under the review rule; add explicit transport deadlines and a bounded-time worker test when scheduled.
- No hydrated editor browser session or real Drive upload was available, so destination authorization, resumable-session behavior, and live zero-byte acceptance remain unverified end to end.
- The mobile folder-picker flow still needs iOS device acceptance for an external Files provider folder, staging, cancellation, and selected-resource access lifetime.

## Applied Review Fixes

- Release progress now reports Drive-acknowledged bytes after staging while retaining private staging progress during `STAGING`.
- Zero-byte Drive uploads omit the invalid start-end `Content-Range`; adapter and worker tests cover the empty upload path.
- Verification passed: the targeted Vitest run (3 files, 46 tests), `pnpm typecheck`, `pnpm lint` (21 existing warnings), and `git diff --check`.
