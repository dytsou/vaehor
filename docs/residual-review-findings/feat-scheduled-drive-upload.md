# Residual review findings: scheduled Drive uploads

## Source

- Plan: `docs/plans/2026-09-29-001-feat-scheduled-drive-upload-plan.md`
- Branch: `feat/scheduled-drive-upload`
- Review base: `5a6d5010d0db89234ed38250ff2ab47283ac943c`
- Reviewed head before this record: `138248ca11f85d83af10b08bede72e4c87e747f2`
- Review run: `/tmp/compound-engineering-501/ce-code-review/20260930-041133-07704eae`
- Final structured report: `/tmp/compound-engineering-501/ce-code-review/20260930-041133-07704eae/review.json`

The review verdict is **Not ready**. Findings #3, #4, #6, and #9 were fixed and verified. Findings #1, #2, and #5 were dismissed as module-size preferences without a demonstrated defect. The external Claude/Opus review attempt returned gateway error 530 and produced no usable artifact or receipt; its model and independence are unverified.

## Residual Review Findings

GitHub authentication succeeded, but `dytsou/vaehor` has Issues disabled. No named project tracker was available in the repository context. No tickets were filed; these items are recorded here as the durable no-sink handoff.

- **#7 P1 — `apps/mobile/src/plugins/upload-bridge.ts:264` — Keep iOS folder access security scoped.** The directory picker returns a security-scoped URL and bookmark, but native scanning uses only the path after the picker has stopped its access scope. iOS folder selection can therefore fail before a schedule is created. Resolve the bookmark and keep its security scope active through enumeration and file reads; copy or return the data before ending the scope. This leaves the planned mobile folder-provider flow unverified on an actual iOS runtime.
- **#8 P1 — `lib/services/scheduled-upload.ts:497` — Scheduled uploads bypass folder access grants.** An editor who knows a protected Drive folder ID can schedule content there. Creation checks the global Vaehor role, and the worker checks write capability with the application's Drive identity, but neither checks the creator's folder grant. Apply the existing folder authorization policy when creating the schedule and again before the first Drive write; pause for administrator attention if access was revoked. Resolve this authorization gap before merging.
- **#10 P2 — `components/features/ScheduledUploads.tsx:209` — Older reload can replace newer schedule state.** A poll and a mutation-triggered reload can overlap; the older response can replace a newer status or error state. Use request generations or cancellation, invalidate in-flight work on cleanup, and allow action-triggered reloads to supersede polls.
- **#11 P2 — `components/features/ScheduledUploads.tsx:348` — Finishing an upload discards newly selected files.** Selection controls remain enabled during staging, while success clears the selection. Disable selection/removal/clear controls during staging, or clear only the original selection if it has not changed.
- **#13 P2 — `lib/services/scheduled-upload.ts:527` — Polling loads every historical package and item.** Every 15-second refresh returns all package records and full item manifests; the response grows without a bound. Add cursor or bounded-history pagination, return compact summaries, and load item details on demand.
- **#14 P2 — `lib/storage/private-scheduled-uploads.ts:341` — Staging assumes each file write consumes every byte.** The staging loop hashes/counts the full chunk but ignores `FileHandle.write`'s `bytesWritten`; a short write can leave a truncated blob marked staged and prevent restaging. Loop until the complete buffer is written, reject zero progress, and cover a short write.
- **#15 P2 — `packages/sdk/src/orval/index.ts:5952` — Binary download client returns Blob for JSON errors.** The generated client reads 401/404 JSON error bodies as Blob even though its error type promises an Error object. Keep successful responses as Blob, parse JSON error responses through a durable custom mutator, regenerate, and add 401/404 contract coverage.

## Residual risk (not in the actionable ticket queue)

- **#12 P2 — `lib/services/scheduled-upload-worker.ts:1541` — Failed cleanup is not retried by the poller.** A transient filesystem or database error can leave staged blobs pending indefinitely because later ticks do not call the cleanup routine. Add a small bounded cleanup pass per tick with isolated failure handling and a test for recovery on a later tick. This was retained as a residual risk rather than an actionable primary finding.

## Validation evidence

- Scheduled-upload and mobile bridge unit tests: 76 passed across 14 files.
- Root and mobile typechecks, scoped Biome, SDK build/compile, production build, Prisma validation, mobile build, Compose config, and diff checks passed.
- The Compose image built successfully. A one-off container confirmed the private staging volume is writable by `nextjs` and has mode `0700`.
- Browser acceptance did not complete: the standalone page returned HTML, but several JavaScript chunks returned 404 and the page remained at Loading. The development guest flow reached the app, but local Google service-account credentials blocked Drive API calls. No editor account or second-user session was available for end-to-end privacy validation.
