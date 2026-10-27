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
| P0-ACC-004 | Diff correctness | Browser diff pane rendered-content assertions | Pass — CI run 152 | Diff view mounts; the modified pane shows the expected marker and the original pane shows the project name. |
| P0-ACC-005 | Diff is read-only | Browser keyboard-edit rejection check | Pass — CI run 152 | A keyboard edit attempt does not alter the draft, and the editor retains the exact proposed content after leaving review. |
| P0-ACC-006 | Reviewed content matches proposed save | Browser request payload assertion | Pass — CI run 152 | The approved POST payload content must exactly equal the reviewed editor draft. |
| P0-ACC-007 | Multi-file diff review | `tests/browser/phase0-acceptance.spec.ts`; `tests/browser/phase0-hardening.spec.ts` | Added — awaiting CI for current head | Rendered original and modified panes must each show distinct expected content for both CSS and HTML. |
| P0-ACC-008 | Rejected write changes no bytes | `tests/phase0-acceptance.test.ts` | Pass — CI run 152 | Missing approval returns 409 and original bytes are identical before/after. |
| P0-ACC-009 | Cancel approval changes no bytes | Browser acceptance test | Pass — CI run 152 | Cancel closes the dialog; reload shows original saved content. |
| P0-ACC-010 | Backup contains exact previous bytes | `tests/phase0-acceptance.test.ts` | Pass — CI run 152 | Backup bytes exactly equal file bytes before replacement. |
| P0-ACC-011 | Backup/write failure does not partially apply | `tests/phase0-acceptance.test.ts`; `tests/phase0-hardening.test.ts` | Added — awaiting CI for current head | Backup creation and atomic-rename failures leave original bytes intact; temporary files are removed and backups remain exact. |
| P0-ACC-012 | Preview cannot access parent context | Browser isolation test | Pass — CI run 152 | Parent DOM access is blocked and parent document remains unchanged. |
| P0-ACC-013 | Preview external network is restricted | `tests/browser/phase0-acceptance.spec.ts`; `tests/browser/phase0-hardening.spec.ts`; `tests/api.test.ts` | Added — awaiting CI for current head | Browser isolation and response-header assertions verify default-deny CSP, external fetch/resource restrictions, and denied form actions. |
| P0-ACC-014 | Preview cannot initiate top-level navigation | Browser test | Pass — CI run 152 | A form targeted at `_top` must not navigate the studio page. |
| P0-ACC-015 | Symlink/path race resistance | `tests/phase0-acceptance.test.ts`; `tests/phase0-hardening.test.ts`; `tests/security.test.ts` | Added — awaiting CI for current head | Parent-directory and final-target symlink swaps must not create or modify outside files; outside sentinels remain byte-identical. Race tests are controlled regression tests, not proof against every OS-level race. |
| P0-ACC-016 | Rejected traversal leaves outside files unchanged | `tests/phase0-acceptance.test.ts` | Pass — CI run 152 | An outside-project sentinel remains byte-for-byte identical after rejected traversal. |
| P0-ACC-017 | Security case-to-test traceability | This matrix and the legacy-test crosswalk below | Added — mapping included; awaiting review and CI | Every existing security/API/browser/edit-history/export suite is mapped to Phase 0 criteria or explicitly classified as supporting regression coverage. |

## Existing tests at the base commit
- `tests/api.test.ts`: project creation, approval guard, save/backup existence, traversal rejection, preview headers, non-local request rejection.
- `tests/security.test.ts`: traversal, absolute/hidden paths, symlink escape, invalid IDs, NUL/size limits, host/origin checks.
- `tests/browser/undo-redo.spec.ts`: edit history, save/reload, file and project switching.
- `tests/edit-history.test.ts`: undo/redo behavior and history boundaries.
- `tests/zip-export.test.ts`: ZIP structure and excluded files.

## Added test files
- `tests/phase0-acceptance.test.ts`: disk-backed listing, byte-for-byte no-write-on-denial, exact backup bytes, backup failure safety, traversal sentinel, controlled parent-directory symlink swap at rename.
- `tests/browser/phase0-acceptance.spec.ts`: project switch/reopen, production-server restart persistence, read-only diff editor and save-payload matching, create/load failure UX, sequential two-file review, approval cancel, preview parent isolation, external fetch restriction, top-level navigation attempt.
- `tests/phase0-hardening.test.ts`: injected atomic-rename failure and final-target symlink-swap safety.
- `tests/browser/phase0-hardening.spec.ts`: direct rendered diff assertions for changed CSS and HTML; preview CSP header checks and browser-level attempts to load external CSS, images, video, iframe, and form targets.

## Verification record — code commit `d6799772f08e244af6e7e8fe46ddcefbaff2842b`
- `npm install`: passed
- Chromium installation: passed
- `npm test`: passed
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run build`: passed
- `npm run test:e2e`: passed
- GitHub Actions run: https://github.com/AligasSRM/Alex-Studio/actions/runs/40554592702

## Legacy test crosswalk (P0-ACC-017)

| Existing suite / case family | Phase 0 mapping | Classification |
|---|---|---|
| `tests/api.test.ts`: create project + starter files | P0-ACC-001 | Direct acceptance evidence |
| `tests/api.test.ts`: approval required, save after approval, backup, traversal rejection | P0-ACC-008, P0-ACC-010, P0-ACC-016 | Direct acceptance evidence |
| `tests/api.test.ts`: restricted preview headers/content, reject non-local preview host, reject non-local create origin | P0-ACC-012, P0-ACC-013, P0-ACC-014 and security guardrail | Direct/supporting regression evidence |
| `tests/security.test.ts`: safe relative path; traversal, absolute, drive-letter, hidden, duplicate-separator rejection | P0-ACC-016 | Direct acceptance evidence |
| `tests/security.test.ts`: project IDs and symlink/dangling-symlink rejection | P0-ACC-015 | Direct/supporting regression evidence |
| `tests/security.test.ts`: NUL and 1 MiB limit | P0-ACC-011 and file-input guardrail | Supporting regression evidence |
| `tests/security.test.ts`: missing/mismatched/remote Origin and Host | P0-ACC-008 and local-request security guardrail | Supporting regression evidence |
| `tests/phase0-acceptance.test.ts` + `tests/phase0-hardening.test.ts`: exact backup, denied writes, backup/rename failure, traversal sentinel, symlink swaps | P0-ACC-008, P0-ACC-010, P0-ACC-011, P0-ACC-015, P0-ACC-016 | Direct acceptance evidence |
| `tests/browser/phase0-acceptance.spec.ts` + `tests/browser/phase0-hardening.spec.ts`: lifecycle/restart, diff, failure UX, preview isolation/network/navigation, multi-file rendered content | P0-ACC-001–007, P0-ACC-009, P0-ACC-012–014 | Direct acceptance evidence |
| `tests/browser/undo-redo.spec.ts` + `tests/edit-history.test.ts` | P0-ACC-001, P0-ACC-005, P0-ACC-009 | Supporting regression evidence |
| `tests/zip-export.test.ts` | Export behavior; supporting product regression, not a named Phase 0 acceptance criterion | Supporting regression evidence |

## Current decision
**Phase 0 remains OPEN / PARTIAL until CI verifies the new tests against the latest branch head and the evidence is reviewed.** The current branch adds direct multi-file diff assertions, rename-failure atomicity, final-target symlink-swap safety, browser checks for preview resource restrictions, and a legacy test crosswalk. A passing test suite demonstrates only the exercised cases; controlled race tests do not prove resistance to every possible OS-level race, and passing CI does not certify production readiness.
