# Alex Studio — Engineering Acceptance Gates A0–A5

**Current status:** A0 remains OPEN. This document is a working gate definition, not evidence that any stage has passed. Work is confined to `recovery/alex-studio-source-import`; do not edit `main`, create a PR, or merge without separate approval.

## Severity order

1. **Critical — file and project access boundaries.** A path-validation or project-deletion defect can expose or destroy data outside the intended workspace.
2. **High — real review-and-apply workflow.** A UI that shows a sample diff but writes a different file is not an acceptable approval boundary.
3. **High — reproducible build and test evidence.** Code is not accepted until automated checks report results for the exact commit.

## A0 — Source and baseline integrity

**Goal:** Establish a reliable, reproducible baseline without losing local work.

Acceptance evidence:
- [ ] Confirm the exact repository, source branch, branch HEAD, and commit SHA.
- [ ] Preserve and separately reconcile any local Termux modifications; never overwrite them blindly.
- [ ] Verify `package.json` and `package-lock.json` agree and `npm ci` succeeds.
- [ ] Restore project-specific documentation instead of the default Next.js README.
- [ ] Record all test commands, current results, known gaps, and exact commit IDs.
- [ ] Keep `main` untouched; no PR or merge without separate authorization.

**Exit rule:** No unresolved source divergence or dependency-lock mismatch; reproducible baseline evidence exists.

## A1 — Critical filesystem and project safety

**Goal:** Prevent reads, writes, backups, and deletes from escaping the intended project.

Acceptance evidence:
- [ ] Reject absolute paths, traversal segments, malformed project IDs, reserved internal paths, and invalid file types.
- [ ] Resolve canonical paths and reject symlink escapes for reads, writes, backups, project listing, and deletion.
- [ ] Validate project metadata and input lengths before filesystem operations.
- [ ] Use collision-resistant temporary files and backup names; clean up temporary artifacts on failure.
- [ ] Bind local development and production servers to loopback until authentication exists.
- [ ] Confirm project APIs cannot access internal metadata, Git data, or dependency folders.
- [ ] Add negative tests for traversal, symlinks, missing projects, directories-as-files, and deletion outside the workspace.

**Exit rule:** All automated filesystem safety tests pass. Any unresolved race condition or untested deletion boundary remains explicitly documented.

## A2 — Real edit, review, approve, and reject workflow

**Goal:** Make the reviewed diff match the exact file that will be changed.

Acceptance evidence:
- [ ] Load the selected project and real file content; remove hard-coded demo changes from the production path.
- [ ] Scope every read/write to a validated project ID and relative file path.
- [ ] Store a draft with the original content and SHA-256 hash.
- [ ] Show the actual diff before approval.
- [ ] Refuse to apply if the current file hash differs from the reviewed base hash.
- [ ] Create a backup before replacing an existing file.
- [ ] Verify the saved file by reading it back and comparing its hash.
- [ ] Verify rejection makes no write request and accurately reports whether the source file stayed unchanged.
- [ ] Test creation, modification, stale-draft conflict, rejection, backup recovery, and read-back failure.

**Exit rule:** The workflow passes integration tests against a real temporary project, not only UI demos.

## A3 — AI provider, request limits, and cost controls

**Goal:** Prevent mock responses from masquerading as real AI and enforce resource limits.

Acceptance evidence:
- [ ] Missing credentials return a clear configuration status; mock mode is explicit and development-only.
- [ ] Validate message role, content type, count, and request size; do not accept user-supplied system messages.
- [ ] Bound upstream timeouts and handle provider failures without leaking response bodies or secrets.
- [ ] Capture provider-reported token usage where available.
- [ ] Persist usage per project and calendar month.
- [ ] Enforce a server-side hard budget limit; do not rely on UI estimates.
- [ ] Add rate limits and tests for missing key, malformed messages, oversized requests, provider failure, and budget exhaustion.

**Exit rule:** Real-provider tests and persistent cost-limit tests pass. Token estimates alone do not satisfy this gate.

## A4 — Preview, export, history, and recovery

**Goal:** Make preview isolation and recovery features verifiable.

Acceptance evidence:
- [ ] Test sandboxed preview behavior in a real browser, including parent access, navigation, popups, network requests, and storage.
- [ ] Verify actual response headers and CSP; do not infer safety from configuration alone.
- [ ] Implement ZIP export with an explicit allowlist and secret/internal-file exclusions.
- [ ] Record meaningful project history and implement tested rollback/recovery behavior.
- [ ] Test backup restore after a simulated failed write and interrupted operation.

**Exit rule:** Browser and filesystem integration tests pass; export and rollback behavior is documented.

## A5 — Final acceptance and release readiness

**Goal:** Demonstrate that the same commit passes the full verification suite.

Required checks:
- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Browser end-to-end tests for project creation, file selection, editing, review, approval, rejection, stale conflict, and preview isolation.
- [ ] Verify mobile/Termux setup instructions and local-only binding.
- [ ] Review dependency advisories and confirm the lockfile is reproducible.
- [ ] Record CI run URL, tested commit SHA, all results, and any remaining risk.

**Exit rule:** All required checks pass for the same commit, no critical/high acceptance item remains open, and the evidence is reviewed. Only then may A0–A5 be marked closed; a successful CI run alone is not production approval.
