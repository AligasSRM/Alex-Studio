# Alex Studio — Post-Merge Verification Record

**Date:** 2026-10-27  
**Repository:** `AligasSRM/Alex-Studio`  
**Scope:** Verification of Undo/Redo merge on `main`  
**Status:** 🟡 **INCOMPLETE — automated PR checks pass; exact-main and browser runtime evidence remain outstanding**

## 1. Target revision

- `main` resolves to merge commit `ddaf3f1b37cb9308d58643acb632891e399a22ec`.
- Commit message: `feat: add editor undo and redo history`.
- GitHub reports the commit signature as verified.
- Merged PR: [#4 — feat: add editor undo and redo history](https://github.com/AligasSRM/Alex-Studio/pull/4).

## 2. CI evidence

### Pre-merge evidence for the Undo/Redo implementation

- [GitHub Actions run #40517939987](https://github.com/AligasSRM/Alex-Studio/actions/runs/40517939987)
- Event: `pull_request`
- Tested PR head SHA: `abe761b07a72328dbfd5fe3070b327f9a4b93e55`
- Result: `completed / success`

### Follow-up documentation PR check

- [GitHub Actions run #40519105244](https://github.com/AligasSRM/Alex-Studio/actions/runs/40519105244)
- Event: `pull_request`, PR #5
- Tested head SHA: `c15c219daf7332d785797d5684f3a0fcac3ee17a`
- Base `main` SHA reported for PR #5: `ddaf3f1b37cb9308d58643acb632891e399a22ec`
- Result: `completed / success`

All steps in run #40519105244 passed:

| Check | Result |
|---|---|
| `npm install` | PASS |
| `npm test` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |

**Evidence limitation:** run #40519105244 validates the PR head against its `main` base; it is not a run on the exact merge commit SHA itself. Do not describe it as direct post-merge CI for `main`.

## 3. Source-level review of the requested interactions

Inspected `components/StudioWorkspace.tsx`, `lib/edit-history.ts`, and `tests/edit-history.test.ts` on `main`.

| Scenario | Source-level finding | Runtime evidence |
|---|---|---|
| Edit → Undo → Redo | UI calls `undoEdit` / `redoEdit` and updates the draft from history state; unit tests cover history ordering | Not run in a browser |
| New edit after Undo | `recordEdit` clears `future`; a unit test covers redo-history invalidation | Not run in a browser |
| Save after Undo/Redo | Save submits the current draft; after success it sets the saved baseline and resets history to the saved content | Not run in a browser |
| Switch files/projects | Successful file selection and project opening load content and reset history for the newly selected file | Not run in a browser |

This is code inspection, not proof of runtime behavior or persistence.

## 4. Why browser checks are still open

The project README defines the prototype as local-only. The API enforces localhost/same-origin restrictions for mutations and there is no supported public test deployment established in the evidence reviewed. I could not start the repository in an execution environment here: a Git clone attempt failed because the execution environment could not resolve `github.com`.

Therefore, I have **not** claimed to perform browser interactions, save/reopen checks, or project-switching checks. Those checks require a running local instance or a deliberately configured test environment that preserves the local-only security boundary.

## 5. CI trigger gap

The current `.github/workflows/ci.yml` triggers on:

- pull requests targeting `main`;
- pushes to `feature/alex-studio-implementation-2026-10-27` only;
- manual `workflow_dispatch`.

It does **not** declare `push` on `main`. A merge into `main` therefore does not automatically trigger this workflow under the current configuration. If post-merge CI is required, address this in a separate reviewed PR; do not edit `main` directly.

## 6. Acceptance decision

**Current decision: 🟡 OPEN — do not mark post-merge verification complete.**

Completed:
1. Verified the target `main` merge SHA and the relevant GitHub CI run records.
2. Confirmed all automated steps in PR #5's run passed.
3. Inspected the Undo/Redo UI wiring, save reset behavior, file/project switching reset behavior, and existing unit tests.
4. Recorded the evidence boundaries without conflating code inspection with runtime testing.

Still outstanding:
1. Run test, typecheck, lint, and production build against the exact merge SHA `ddaf3f1b37cb9308d58643acb632891e399a22ec` (for example, via a controlled `workflow_dispatch` run against that ref).
2. In a running local browser instance, perform edit → undo → redo.
3. Undo, make a different edit, and verify Redo is disabled / unavailable.
4. Save after Undo and after Redo; reopen the file and verify the persisted content.
5. Switch files and projects after editing; verify the correct content is loaded and no stale history is applied.
6. Record exact runtime environment, tested SHA, and observed outcomes.

This record does not claim that unperformed checks passed. `main` has not been modified directly, PR #5 has not been merged, and PR #1 has not been touched.
