# Phase 5 — Acceptance Evidence

Date: 2026-10-29  
Scope: Phase 5 acceptance and evidence only.

## Five acceptance items

1. **ZIP export path:** the project export endpoint returns a downloadable ZIP with expected response headers. The route test checks the ZIP signature and verifies that hidden/internal and sensitive files are excluded.
2. **Durable batch manifest:** the current main branch contains private per-batch snapshots in `lib/ai-apply-batches.ts`; `tests/ai-apply-batches.test.ts` verifies persistence, restrictive permissions, and metadata-only history output.
3. **User-facing history and rollback:** `components/AIApplyHistory.tsx`, `app/api/ai/apply/history/route.ts`, and `app/api/ai/apply/rollback/route.ts` provide the history and guarded rollback workflow.
4. **Regression evidence:** `tests/ai-apply-rollback-route.test.ts` covers apply, history, rollback, stale-file rejection, and recovery behavior. `tests/projects-export-route.test.ts` covers ZIP download behavior and exclusion rules.
5. **CI and closure evidence:** this pull request must pass unit tests, typecheck, lint, production build, and browser acceptance. The merged commit must then be verified before the phase is marked closed.

## Acceptance notes

- The history API returns summaries rather than saved file contents.
- Rollback validates current file state before writing and refuses to overwrite newer edits.
- The ZIP exporter excludes internal/hidden files and sensitive-name patterns.
- File contents are not added to the metadata-only audit ledger.

## Evidence status

Batch manifests, history, and guarded rollback are already present on the current main branch. This Phase 5 change adds the missing export-route acceptance test and consolidates the five acceptance gates. Final closure depends on successful CI for this pull request and post-merge verification; this document is not itself a substitute for those checks.
