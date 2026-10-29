# Phase 4 Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit scope:** ZIP export security, editor undo/redo lifecycle, approved multi-file apply rollback, evidence gates, and phase disposition.  
**Baseline:** `main` commit `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`.  
**Disposition:** Phase 4 remains OPEN. ZIP-export item 1 is implemented and its main-branch CI passed; the remaining findings below must be resolved or explicitly accepted before phase closure.

## Ordered work items

| # | Item | Evidence | Status |
|---|---|---|---|
| 1 | ZIP export security | `lib/zip-export.ts`, `tests/zip-export.test.ts`; PR [#70](https://github.com/AligasSRM/Alex-Studio/pull/70) merged as `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`; [main CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206) completed successfully | PASS for implemented checks; residual limitation documented |
| 2 | Editor undo/redo lifecycle | `lib/edit-history.ts`, `tests/edit-history.test.ts`, `tests/browser/undo-redo.spec.ts` | Core behavior tested; persistence is intentionally in-memory and resets on save/reopen or file/project switch |
| 3 | Approved multi-file batch rollback and user-visible history | `app/api/ai/apply/route.ts` validates file hashes, snapshots contents, attempts reverse-order rollback on failure | Partial: failure rollback exists, but rollback errors are swallowed and there is no durable applied-batch history or user-facing post-apply rollback control |
| 4 | Acceptance evidence | CI run linked above is green on exact main commit `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`; editor behavior has unit and browser tests | Partial: no automated route-level regression proof found for injected mid-batch failure and rollback failure |
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
- Rollback is best-effort. Rollback exceptions are swallowed, so the response does not enumerate files that could not be restored.
- Existing-file writes create per-file backups, but there is no durable transaction manifest for an approved batch.
- No user-facing action was found to list approved batches or reverse a successfully applied batch after the fact.
- No route-level regression proof was found for a deliberately injected mid-batch write failure followed by verification that every file matches its original bytes.

These are the main blockers if Phase 4 acceptance requires reliable transactional recovery and post-apply rollback, rather than only best-effort recovery during a failed write.

## Item 4 — Evidence and validation gate

- [x] ZIP regression tests, type check, lint, production build, and browser acceptance passed in [CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206).
- [x] The run tested exact main commit `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`.
- [x] Editor unit and browser tests exist for the documented in-session history lifecycle.
- [ ] Add route-level tests for batch apply success, stale base hash rejection, a mid-batch failure, complete reverse-order restoration, and a rollback failure that is surfaced explicitly.
- [ ] Decide whether durable batch history and post-apply rollback are required for Phase 4. If required, implement and test them before closure; if not, document this as an explicit scope limitation.
- [ ] Decide whether persistent undo history is required. Current implementation is session-only and tests should continue to assert that contract unless persistence is deliberately implemented.

## Closure decision

**Phase 4 is not closed.** Item 1 is complete with a green main CI run. The editor history contract is tested but session-only. The apply endpoint has best-effort failure rollback, but durable batch history, user-facing rollback, and route-level failure-injection proof remain unresolved. Do not close the phase until the project acceptance criteria explicitly resolve these gaps and the resulting code and evidence pass CI on the same main commit.
