# Phase 4 Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit scope:** ZIP export security, editor undo/redo lifecycle, approved multi-file apply rollback, evidence gates, and phase disposition.  
**Baseline:** `main` commit `ab92cf2479fc85db06ea6c37ccdbf0b6fa2ae029`.  
**Disposition:** Phase 4 remains OPEN. ZIP-export item 1 is implemented and its main-branch CI passed; the remaining findings below must be resolved or explicitly accepted before phase closure.

## Ordered work items

| # | Item | Evidence | Status |
|---|---|---|---|
| 1 | ZIP export security | `lib/zip-export.ts`, `tests/zip-export.test.ts`; PR [#70](https://github.com/AligasSRM/Alex-Studio/pull/70) merged as `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`; [main CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206) completed successfully | PASS for implemented checks; residual limitation documented |
| 2 | Editor undo/redo lifecycle | `lib/edit-history.ts`, `tests/edit-history.test.ts`, `tests/browser/undo-redo.spec.ts` | Core behavior tested; persistence is intentionally in-memory and resets on save/reopen or file/project switch |
| 3 | Approved multi-file batch rollback and user-visible history | `app/api/ai/apply/route.ts`, `lib/ai-apply-rollback.ts`, `tests/ai-apply-rollback.test.ts`; PR [#72](https://github.com/AligasSRM/Alex-Studio/pull/72) merged as `ab92cf2479fc85db06ea6c37ccdbf0b6fa2ae029`; [PR CI run 40882793268](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882793268) passed | Partial: rollback failures are now surfaced and unit-tested; no durable applied-batch history or user-facing post-apply rollback control |
| 4 | Acceptance evidence | [main CI run 40883041909](https://github.com/AligasSRM/Alex-Studio/actions/runs/40883041909) is green on exact main commit `ab92cf2479fc85db06ea6c37ccdbf0b6fa2ae029`; editor behavior has unit and browser tests | Partial: no automated route-level regression proof found for injected mid-batch failure and rollback failure |
| 5 | Final report and closure decision | This report | Report recorded; phase remains OPEN pending remaining acceptance gaps |

## Item 1 — ZIP export security

The exporter now excludes hidden paths, `.git`, `.alex`, `node_modules`, and common secret-bearing names at any depth, including credentials, secrets, passwords, tokens, API/private/access keys, SSH key names, and common certificate/key-store extensions. ZIP-content tests decompress the archive and assert both sensitive paths and known sentinel contents are absent while normal files remain present. Tests also cover nested symlinks and the 10,000-file / 50 MiB limits.

**Evidence:** PR [#70](https://github.com/AligasSRM/Alex-Studio/pull/70); [CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206), completed successfully on the exact main commit above.

**Limitation:** filename-based exclusion cannot detect a secret embedded in an otherwise ordinary source file, and conservative patterns may omit legitimate files with secret-like names. This is not a full content-level secret scanner.

## Item 2 — Editor history lifecycle

The editor uses an in-memory history capped at 100 prior values. Unit tests cover ordering, redo invalidation after a new edit, duplicate values, the history cap, and boundary behavior. Browser tests cover edit → undo → redo, new-branch invalidation, save/reload content preservation, and clearing stale history when switching files/projects.

**Finding:** undo/redo history is not durable across reloads or saves, and save resets the current file's history. Saved content is verified to persist; historical editor states are not. This is safe as a bounded session-history model but must not be described as persistent undo history.

## Item 3 — Approved batch apply and rollback

The AI apply endpoint requires explicit approval and a successful current verification proof; validates canonical unique paths, protected paths, base hashes, file count and byte limits; snapshots current contents; and attempts to roll back previously applied files in reverse order if a later write fails.

**Findings:**
- The API now returns `rollback.status` plus either `failedPaths` when restoration is incomplete or `restoredPaths` when all previously applied files were restored.
- The extracted rollback helper continues restoring other files after one restore fails; unit tests cover reverse order, unapplied files, and failed restore reporting. PR #72 and its CI passed before merge.
- Existing-file writes create per-file backups, but there is no durable transaction manifest for an approved batch.
- No user-facing action was found to list approved batches or reverse a successfully applied batch after the fact.
- Route-level failure injection verifying original bytes after a mid-batch failure is still missing.

The current main-branch CI, including unit tests, type check, lint, production build, and browser acceptance, passed on `ab92cf2479fc85db06ea6c37ccdbf0b6fa2ae029`: [CI run 40883041909](https://github.com/AligasSRM/Alex-Studio/actions/runs/40883041909). These remaining gaps matter if Phase 4 acceptance requires durable transactional history and post-apply rollback, rather than failure-time recovery with explicit diagnostics.

## Item 4 — Evidence and validation gate

- [x] ZIP regression tests, type check, lint, production build, and browser acceptance passed in [CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206); the complete current main branch passed again after rollback changes in [CI run 40883041909](https://github.com/AligasSRM/Alex-Studio/actions/runs/40883041909).
- [x] The ZIP-focused run tested exact main commit `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`; current main CI tested exact commit `ab92cf2479fc85db06ea6c37ccdbf0b6fa2ae029`.
- [x] Editor unit and browser tests exist for the documented in-session history lifecycle.
- [x] Unit tests cover rollback order, skipped unapplied paths, and explicit reporting of rollback failures; [PR CI run 40882793268](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882793268) passed on the PR head before merge.
- [ ] Add route-level tests for batch apply success, stale base hash rejection, a mid-batch failure, and verification that all original file bytes are restored.
- [ ] Decide whether durable batch history and post-apply rollback are required for Phase 4. If required, implement and test them before closure; if not, document this as an explicit scope limitation.
- [ ] Decide whether persistent undo history is required. Current implementation is session-only and tests should continue to assert that contract unless persistence is deliberately implemented.

## Closure decision

**Phase 4 is not closed.** Item 1 is complete with a green main CI run. Item 3 now surfaces incomplete rollback paths and has passing helper-level regression tests; the updated main commit also passed full CI. Durable batch history, user-facing post-apply rollback, and route-level failure-injection proof remain unresolved. The editor history contract is tested but session-only. Do not close the phase until the project acceptance criteria explicitly resolve these gaps and the resulting code and evidence pass CI on the same main commit.
