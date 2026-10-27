# Alex Studio — Phase 0 Acceptance Test Baseline

- Date: 2026-10-27
- Repository: `AligasSRM/Alex-Studio`
- Base commit: `6096c8c210ad5e566a821ae63ace64af3ba2eabc`
- Work branch: `test/phase-0-acceptance-suite`
- Status: **CI passed for code commit `d6799772f08e244af6e7e8fe46ddcefbaff2842b`**
- CI run: https://github.com/AligasSRM/Alex-Studio/actions/runs/40554592702
- Scope: Phase 0 acceptance tests only. This document does not approve release or close Phase 0.

## Status vocabulary
- **Existing** — a test existed at the base commit before this work.
- **Added** — a test was added on this branch; its result is not claimed until CI reports it.
- **Pending** — not proven by the test suite in this branch.
- **Pass** — only after a recorded test run against the exact commit.

## Acceptance matrix

| ID | Criterion | Test/evidence | Status on this branch | Acceptance condition |
|---|---|---|---|---|
| P0-ACC-001 | Project lifecycle and switching | `tests/browser/phase0-acceptance.spec.ts`; `tests/phase0-acceptance.test.ts` | Pass — CI run 152 | Create two projects, switch back, and confirm saved content and project records persist on disk. |
| P0-ACC-002 | Persistence across a real server restart | Production-server restart test in browser acceptance suite | Pass — CI run 152 | Stop and restart the production server process, then verify project metadata and exact saved content through the API. |
| P0-ACC-003 | Project create/load failure UX | Browser fault-injection tests | Pass — CI run 152 | Failed create and project-list/file loading show visible errors; failed file loading preserves the previously active workspace. |
| P0-ACC-004 | Diff correctness | Browser diff pane rendered-content assertions | Pass — CI run 152 | Diff view mounts after a known edit. Rendered-line comparison remains pending. |
| P0-ACC-005 | Diff is read-only | Browser keyboard-edit rejection check | Pass — CI run 152 | Monaco diff input areas report read-only; draft remains unchanged after leaving review. |
| P0-ACC-006 | Reviewed content matches proposed save | Browser request payload assertion | Pass — CI run 152 | The approved POST payload content must exactly equal the reviewed editor draft. |
| P0-ACC-007 | Multi-file diff review | Browser sequential two-file review test | Pass — CI run 152; sequential per-file scope | Two changed files can be reviewed independently; direct rendered-line comparison remains pending. |
| P0-ACC-008 | Rejected write changes no bytes | `tests/phase0-acceptance.test.ts` | Pass — CI run 152 | Missing approval returns 409 and original bytes are identical before/after. |
| P0-ACC-009 | Cancel approval changes no bytes | Browser acceptance test | Pass — CI run 152 | Cancel closes the dialog; reload shows original saved content. |
| P0-ACC-010 | Backup contains exact previous bytes | `tests/phase0-acceptance.test.ts` | Pass — CI run 152 | Backup bytes exactly equal file bytes before replacement. |
| P0-ACC-011 | Backup/write failure does not partially apply | `tests/phase0-acceptance.test.ts` | Pass for backup-creation failure; broader filesystem failures pending | Deterministic backup-creation failure leaves original untouched. Other filesystem/rename failure modes remain pending. |
| P0-ACC-012 | Preview cannot access parent context | Browser isolation test | Pass — CI run 152 | Parent DOM access is blocked and parent document remains unchanged. |
| P0-ACC-013 | Preview external network is restricted | Browser isolation test | Pass for external fetch; other resource types pending | External fetch is blocked by preview CSP. Resource loads and other navigation/form variants need broader coverage. |
| P0-ACC-014 | Preview cannot initiate top-level navigation | Browser test | Pass — CI run 152 | A form targeted at `_top` must not navigate the studio page. |
| P0-ACC-015 | Symlink/path race resistance | Controlled parent-directory symlink swap test in `tests/phase0-acceptance.test.ts` | Pass for controlled rename-boundary scenario; broader races pending | A symlink swap at the write/rename boundary must not create or modify files outside the project. |
| P0-ACC-016 | Rejected traversal leaves outside files unchanged | `tests/phase0-acceptance.test.ts` | Pass — CI run 152 | An outside-project sentinel remains byte-for-byte identical after rejected traversal. |
| P0-ACC-017 | Security case-to-test traceability | This matrix + `tests/security.test.ts` | Partial — the Phase 0 acceptance IDs are mapped; full legacy security-case mapping remains | Each required case is linked to an executable test and its observed result; results must be filled from CI. |

## Existing tests at the base commit
- `tests/api.test.ts`: project creation, approval guard, save/backup existence, traversal rejection, preview headers, non-local request rejection.
- `tests/security.test.ts`: traversal, absolute/hidden paths, symlink escape, invalid IDs, NUL/size limits, host/origin checks.
- `tests/browser/undo-redo.spec.ts`: edit history, save/reload, file and project switching.
- `tests/edit-history.test.ts`: undo/redo behavior and history boundaries.
- `tests/zip-export.test.ts`: ZIP structure and excluded files.

## Added test files
- `tests/phase0-acceptance.test.ts`: disk-backed listing, byte-for-byte no-write-on-denial, exact backup bytes, backup failure safety, traversal sentinel, controlled parent-directory symlink swap at rename.
- `tests/browser/phase0-acceptance.spec.ts`: project switch/reopen, production-server restart persistence, read-only diff editor and save-payload matching, create/load failure UX, sequential two-file review, approval cancel, preview parent isolation, external fetch restriction, top-level navigation attempt.

## Verification record — code commit `d6799772f08e244af6e7e8fe46ddcefbaff2842b`
- `npm install`: passed
- Chromium installation: passed
- `npm test`: passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed
- `npm run test:e2e`: passed
- GitHub Actions run: https://github.com/AligasSRM/Alex-Studio/actions/runs/40554592702

The documentation-only update after this code commit does not change the tested source or test files. Do not close Phase 0 while any **Pending** or failing high-risk acceptance item remains.

## Current decision
**Phase 0 remains OPEN / PARTIAL despite the passing CI run.** Core acceptance tests pass on the recorded code commit. Remaining coverage gaps include additional backup/rename failure modes, broader preview resource-type restrictions, and complete mapping of every legacy security test to a Phase 0 acceptance ID. The passing suite does not by itself close Phase 0 or certify production readiness.
