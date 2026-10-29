# Phase 5 — ZIP Export, Batch History, and Recovery Acceptance

Date: 2026-10-29  
Scope: Phase 5 only. This document records the acceptance gates for project ZIP export and durable AI-apply recovery.

## Acceptance checklist

1. **ZIP export path** — exercise the project export route, assert downloadable ZIP response headers and ZIP signature, and verify sensitive/internal files are not included.
2. **Durable batch manifest** — persist a per-batch manifest under the project's private `.alex/batches` directory. Manifests retain pre-apply text snapshots and hashes with restrictive file permissions; the user-facing history exposes metadata only.
3. **User-facing batch history and rollback** — list recent batch metadata in the workspace. Rollback is available only for a batch whose manifest is in `applied` state.
4. **Integrity-guarded rollback** — before any writes, verify all targets are regular files and their current SHA-256 hashes still match the post-apply hashes. A stale/missing/unsafe target rejects the operation without changing files. Restores run in reverse order; repeat rollback is rejected.
5. **Verification and evidence** — CI must pass the repository's tests, typecheck, lint and build gates. The PR/merge and post-merge workflow results are the execution evidence; this document alone is not proof of a passing run.

## Implementation details

- Apply writes the recovery manifest before mutating project files and marks it `applied` only after the full batch is written.
- Manifests contain recovery snapshots, so they are stored separately from the metadata-only JSONL audit ledger with mode `0600` files and mode `0700` batch directory.
- The history endpoint returns batch identifiers, timestamps, paths, hashes and state; it does not return saved file contents.
- Rollback is local-origin-only, rejects batches not in `applied` state, checks all file hashes before the first write, and marks a successful rollback as `rolled-back`.
- If a rollback fails part-way through, the manifest remains `rollback-in-progress` for explicit recovery rather than falsely claiming success.

## Evidence status

- ZIP export route regression tests added.
- Post-apply rollback success, repeat-operation rejection and stale-file protection tests added.
- Batch history/rollback UI and API routes added.
- **CI acceptance: pending execution on the phase-5 pull request. Do not mark Phase 5 closed until required checks pass and the merged commit is verified.**
