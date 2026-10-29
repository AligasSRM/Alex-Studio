# Phase 5 — ZIP Export and Recovery Acceptance

Date: 2026-10-29  
Scope: Phase 5 only.

## Acceptance gates and implementation evidence

1. **ZIP export route acceptance** — regression coverage verifies a downloadable ZIP response, attachment headers, ZIP signature, exclusion of secret-bearing files, and rejection of non-local requests. Test: `tests/projects-export-route.test.ts`. Export implementation: `app/api/projects/export/route.ts` and `lib/zip-export.ts`.
2. **Durable batch manifest** — the current main branch persists bounded before/after snapshots and batch state in the private `.alex/ai-apply-batches` directory. Implementation: `lib/ai-apply-batches.ts`.
3. **User-facing history** — the current main branch exposes recent batch metadata without returning saved file contents and renders the history in the workspace. Implementation: `app/api/ai/apply/history/route.ts` and `components/AIApplyHistory.tsx`.
4. **Guarded post-apply rollback** — the current main branch requires explicit approval, validates current file state before writes, and records rollback outcomes. Implementation: `app/api/ai/apply/rollback/route.ts`; route regression coverage: `tests/ai-apply-rollback-route.test.ts` and `tests/ai-apply-batches.test.ts`.
5. **Verification and evidence** — the new ZIP route test must pass with the full required CI workflow. The PR and post-merge CI results are the acceptance evidence; this document alone is not proof of passing checks.

## Safety properties

- ZIP export must not include secret-bearing or internal metadata files.
- Batch snapshots are stored outside the exportable project files, with restrictive permissions and bounded storage.
- History exposes metadata only; snapshot contents are not returned to the browser.
- Rollback must refuse to overwrite unrelated newer edits and must report incomplete recovery honestly.
- Phase 5 must remain open until required checks pass on the final PR head, changes merge through the protected branch workflow, and post-merge CI passes.

## Evidence status

- ZIP route regression test: added in this Phase 5 PR; CI pending.
- Durable manifest, user-facing history, and guarded rollback: present on current `main` with their regression tests.
- **Phase 5 closure: not yet approved.** Await final PR CI and post-merge verification.
