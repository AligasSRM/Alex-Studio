# Alex Studio — Phase 0 Acceptance Test Baseline

- Date: 2026-10-27
- Repository: `AligasSRM/Alex-Studio`
- Base commit: `6096c8c210ad5e566a821ae63ace64af3ba2eabc`
- Work branch: `test/phase-0-acceptance-suite`
- Status: **Implementation candidate — CI verification required**
- Scope: Phase 0 acceptance tests only. This document does not approve release or close Phase 0.

## Status vocabulary
- **Existing** — a test existed at the base commit before this work.
- **Added** — a test was added on this branch; its result is not claimed until CI reports it.
- **Pending** — not proven by the test suite in this branch.
- **Pass** — only after a recorded test run against the exact commit.

## Acceptance matrix

| ID | Criterion | Test/evidence | Status on this branch | Acceptance condition |
|---|---|---|---|---|
| P0-ACC-001 | Project lifecycle and switching | `tests/browser/phase0-acceptance.spec.ts`; `tests/phase0-acceptance.test.ts` | Added | Create two projects, switch back, and confirm saved content and project records persist on disk. |
| P0-ACC-002 | Persistence across a real server restart | CI/manual restart evidence | Pending | Stop and restart the server process, then re-open the project and compare saved file bytes. Disk-backed listing alone is not a server-restart test. |
| P0-ACC-003 | Project create/load failure UX | Browser fault-injection test | Pending | A failed create/load request yields a visible error and does not corrupt the selected project. |
| P0-ACC-004 | Diff correctness | Browser diff view smoke test | Added, partial | Diff view mounts after a known edit. Rendered-line comparison remains pending. |
| P0-ACC-005 | Diff is read-only | Browser Monaco input-area check | Added | Monaco diff input areas report read-only; draft remains unchanged after leaving review. |
| P0-ACC-006 | Reviewed content matches proposed save | Review/draft flow | Added, partial | Review and save use the same draft; byte-for-byte UI-to-write assertion remains pending. |
| P0-ACC-007 | Multi-file diff review | Targeted multi-file review test | Pending | Review two changed files independently and verify each diff against its own original and draft. |
| P0-ACC-008 | Rejected write changes no bytes | `tests/phase0-acceptance.test.ts` | Added | Missing approval returns 409 and original bytes are identical before/after. |
| P0-ACC-009 | Cancel approval changes no bytes | Browser acceptance test | Added | Cancel closes the dialog; reload shows original saved content. |
| P0-ACC-010 | Backup contains exact previous bytes | `tests/phase0-acceptance.test.ts` | Added | Backup bytes exactly equal file bytes before replacement. |
| P0-ACC-011 | Backup/write failure does not partially apply | `tests/phase0-acceptance.test.ts` | Added, partial | Deterministic backup-creation failure leaves original untouched. Other filesystem/rename failure modes remain pending. |
| P0-ACC-012 | Preview cannot access parent context | Browser isolation test | Added | Parent DOM access is blocked and parent document remains unchanged. |
| P0-ACC-013 | Preview external network is restricted | Browser isolation test | Added, partial | External fetch is blocked by preview CSP. Resource loads and other navigation/form variants need broader coverage. |
| P0-ACC-014 | Preview cannot initiate top-level navigation | Browser test | Added | A form targeted at `_top` must not navigate the studio page. |
| P0-ACC-015 | Symlink/path race resistance | Existing static symlink tests; race-specific test pending | Pending | A controlled race test must prove path validation cannot be invalidated between check and write. |
| P0-ACC-016 | Rejected traversal leaves outside files unchanged | `tests/phase0-acceptance.test.ts` | Added | An outside-project sentinel remains byte-for-byte identical after rejected traversal. |
| P0-ACC-017 | Security case-to-test traceability | This matrix + `tests/security.test.ts` | Added, partial | Each required case is linked to an executable test and its observed result; results must be filled from CI. |

## Existing tests at the base commit
- `tests/api.test.ts`: project creation, approval guard, save/backup existence, traversal rejection, preview headers, non-local request rejection.
- `tests/security.test.ts`: traversal, absolute/hidden paths, symlink escape, invalid IDs, NUL/size limits, host/origin checks.
- `tests/browser/undo-redo.spec.ts`: edit history, save/reload, file and project switching.
- `tests/edit-history.test.ts`: undo/redo behavior and history boundaries.
- `tests/zip-export.test.ts`: ZIP structure and excluded files.

## Added test files
- `tests/phase0-acceptance.test.ts`: disk-backed listing, byte-for-byte no-write-on-denial, exact backup bytes, backup failure safety, traversal sentinel.
- `tests/browser/phase0-acceptance.spec.ts`: project switch/reopen, read-only diff editor, approval cancel, preview parent isolation, external fetch restriction, top-level navigation attempt.

## Required verification before marking ready
1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. `npm run test:e2e` with Chromium installed
6. Record the CI run URL and result for this exact commit.
7. Do not close Phase 0 while any **Pending** or failing high-risk acceptance item remains.

## Current decision
**Phase 0 remains OPEN / PARTIAL.** This branch adds executable acceptance coverage but does not itself prove a pass, close the stage, or certify production readiness. Real server-restart persistence, create/load fault injection, complete multi-file diff review, controlled filesystem race coverage, and complete case-to-test traceability remain explicit gaps.
