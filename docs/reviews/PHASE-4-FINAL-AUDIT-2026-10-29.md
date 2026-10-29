# Phase 4 Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit scope:** ZIP export security, editor undo/redo lifecycle, approved multi-file apply rollback, evidence gates, and phase disposition.  
**Baseline:** `main` commit `ab92cf2479fc85db06ea6c37ccdbf0b6fa2ae029` (initial audit baseline).  
**Latest implementation:** PR [#78](https://github.com/AligasSRM/Alex-Studio/pull/78) merged as `98d55fe5267658764ecc2c9705de31ae563d551c`; pre-merge CI [40895335131](https://github.com/AligasSRM/Alex-Studio/actions/runs/40895335131) passed. Main-branch post-merge CI [40895826408](https://github.com/AligasSRM/Alex-Studio/actions/runs/40895826408) completed successfully on merge commit `98d55fe5267658764ecc2c9705de31ae563d551c`.  
**Disposition:** Phase 4 remains OPEN pending successful CI evidence for persistent editor undo/redo and final review.

## Ordered work items

| # | Item | Evidence | Status |
|---|---|---|---|
| 1 | ZIP export security | `lib/zip-export.ts`, `tests/zip-export.test.ts`; PR [#70](https://github.com/AligasSRM/Alex-Studio/pull/70) merged as `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`; [main CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206) completed successfully | PASS for implemented checks; residual limitation documented |
| 2 | Editor undo/redo lifecycle | `lib/edit-history.ts`, `lib/editor-history-store.ts`, `app/api/editor-history/route.ts`, `tests/edit-history.test.ts`, `tests/editor-history-store.test.ts`, `tests/browser/undo-redo.spec.ts` | Persistent per-file history implemented with bounded snapshots, private `.alex/editor-history` storage, and stale-history reset; CI pending |
| 3 | Approved multi-file batch rollback and user-visible history | `app/api/ai/apply/route.ts`, `app/api/ai/apply/history/route.ts`, `app/api/ai/apply/rollback/route.ts`, `lib/ai-apply-batches.ts`, `components/AIApplyHistory.tsx`; PR [#78](https://github.com/AligasSRM/Alex-Studio/pull/78) merged as `98d55fe5267658764ecc2c9705de31ae563d551c`; [PR CI run 40895335131](https://github.com/AligasSRM/Alex-Studio/actions/runs/40895335131) passed on tested head `1ccdcb1f9dd1c2d82dbfc21b88eb1054669e5015`, and [main CI run 40895826408](https://github.com/AligasSRM/Alex-Studio/actions/runs/40895826408) passed on exact merge commit `98d55fe5267658764ecc2c9705de31ae563d551c` | Implemented: durable private before/after snapshots, history listing, explicit guarded post-apply rollback, interrupted rollback recovery, and route/storage regression tests |
| 4 | Acceptance evidence | PR [#77](https://github.com/AligasSRM/Alex-Studio/pull/77) CI [#40892516626](https://github.com/AligasSRM/Alex-Studio/actions/runs/40892516626) and PR [#78](https://github.com/AligasSRM/Alex-Studio/pull/78) CI [#40895335131](https://github.com/AligasSRM/Alex-Studio/actions/runs/40895335131) both passed on their exact tested heads | Core transactional routes, stale-base rejection, original-byte restoration, durable batch history, post-apply rollback, and interrupted-rollback recovery have automated coverage; persistent editor undo/redo is implemented in PR #85 and awaits its CI gate |
| 5 | Final report and closure decision | This report | Report recorded; phase remains OPEN pending remaining acceptance gaps |

## Item 1 — ZIP export security

The exporter now excludes hidden paths, `.git`, `.alex`, `node_modules`, and common secret-bearing names at any depth, including credentials, secrets, passwords, tokens, API/private/access keys, SSH key names, and common certificate/key-store extensions. ZIP-content tests decompress the archive and assert both sensitive paths and known sentinel contents are absent while normal files remain present. Tests also cover nested symlinks and the 10,000-file / 50 MiB limits.

**Evidence:** PR [#70](https://github.com/AligasSRM/Alex-Studio/pull/70); [CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206), completed successfully on the exact main commit above.

**Limitation:** filename-based exclusion cannot detect a secret embedded in an otherwise ordinary source file, and conservative patterns may omit legitimate files with secret-like names. This is not a full content-level secret scanner.

## Item 2 — Editor history lifecycle

The editor history remains capped at 100 prior values and 100 redo values. A new local API persists each file's history under the project's private `.alex/editor-history` directory, using a SHA-256 key derived from the relative file path, atomic writes, restrictive directory/file permissions (0700/0600), and a 16 MiB serialized-state limit. The API accepts only local same-origin mutations and validates that the target is a readable project file. On reload, the saved disk content is authoritative: unsaved draft text is discarded, while undo history is reconciled to the last saved version when it remains in the timeline. Malformed or stale history is reset to the authoritative saved file rather than overwriting newer external edits. The editor no longer clears history on save, and browser coverage now checks undo/redo after reload and per-file history after switching files/projects.

**Finding:** persistent editor undo/redo is implemented in this branch, but it is not yet accepted as complete until unit, type, lint, build, and browser acceptance CI passes on the exact PR head and the final main-branch evidence is recorded.

## Item 3 — Approved batch apply and rollback

The AI apply endpoint requires explicit approval and a successful current verification proof; validates canonical unique paths, protected paths, base hashes, file count and byte limits; snapshots current contents; and attempts to roll back previously applied files in reverse order if a later write fails.

**Findings:**
- The API now returns `rollback.status` plus either `failedPaths` when restoration is incomplete or `restoredPaths` when all previously applied files were restored.
- The extracted rollback helper continues restoring other files after one restore fails; unit tests cover reverse order, unapplied files, and failed restore reporting. PR #72 and its CI passed before merge.
- PR #78 adds durable before/after transaction manifests under private `.alex/ai-apply-batches` storage with restrictive directory/file permissions and a serialized manifest size cap. ZIP export excludes `.alex`.
- A local-only history endpoint and workspace controls list batch summaries and offer explicit post-apply rollback. The rollback endpoint checks that each affected file still matches the batch output or an already-restored original state; it refuses to overwrite newer user edits.
- Route/storage tests cover history without exposing contents, successful post-apply rollback, stale/newer-edit rejection, explicit approval and same-origin enforcement, interrupted rollback recovery, manifest permissions, invalid manifests, and symlinked metadata directories. PR #78 merged as `98d55fe5267658764ecc2c9705de31ae563d551c`; CI [#40895335131](https://github.com/AligasSRM/Alex-Studio/actions/runs/40895335131) passed on tested head `1ccdcb1f9dd1c2d82dbfc21b88eb1054669e5015`.

The current-main CI evidence for the earlier ZIP and rollback work remains recorded above. PR #85 adds persistent editor undo/redo; its full unit, type, lint, production-build, and browser-acceptance run must pass on the exact PR head before merge, followed by post-merge main CI.

## Item 4 — Evidence and validation gate

- [x] ZIP regression tests, type check, lint, production build, and browser acceptance passed in [CI run 40882059206](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882059206); the complete current main branch passed again after rollback changes in [CI run 40883041909](https://github.com/AligasSRM/Alex-Studio/actions/runs/40883041909).
- [x] The ZIP-focused run tested exact main commit `f0e8fb29e13de66a598a11ed74b5d7e6fc73011c`; current main CI tested exact commit `ab92cf2479fc85db06ea6c37ccdbf0b6fa2ae029`.
- [x] Editor unit and browser tests exist for the documented in-session history lifecycle.
- [x] Unit tests cover rollback order, skipped unapplied paths, and explicit reporting of rollback failures; [PR CI run 40882793268](https://github.com/AligasSRM/Alex-Studio/actions/runs/40882793268) passed on the PR head before merge.
- [x] Route-level tests cover batch apply success, stale base-hash rejection, a mid-batch failure with original-byte restoration, and explicit reporting when restoration fails; PR [#77](https://github.com/AligasSRM/Alex-Studio/pull/77) merged as `ed141826b382d78be4d7089bb51caa7220f11d5a`; CI [#40892516626](https://github.com/AligasSRM/Alex-Studio/actions/runs/40892516626) passed on the tested PR head.
- [x] Durable batch history and guarded post-apply rollback implemented and tested in PR #78; CI passed on the exact tested head.
- [x] Product decision: editor undo/redo must persist across save/reopen; session-only behavior is not accepted.
- [x] Persistent per-file editor history implemented under private `.alex/editor-history` storage, with stale-history reset and bounded snapshots.
- [x] Unit and browser tests updated to cover persistence across reloads and file/project switching.
- [ ] Run and record full CI (unit tests, type check, lint, production build, browser acceptance) against the exact persistent-undo PR head and after merge.

## Closure decision

**Phase 4 remains OPEN pending validation of the persistent editor undo/redo implementation.** The product contract is now explicit: history must survive save/reopen and file/project navigation. Persistent storage and recovery behavior have been implemented with bounded, private per-file snapshots and stale-history protection. Do not close Phase 4 until the full CI suite passes on the exact PR head, the change is merged, and post-merge main CI passes on the exact merge commit.
