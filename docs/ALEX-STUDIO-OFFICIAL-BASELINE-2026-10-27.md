# Alex Studio — Official Project Baseline and Build Charter

- **Document status:** Initial official baseline, recorded for Ali's review; not a claim of release readiness.
- **Document date:** 2026-10-27
- **Repository:** `AligasSRM/Alex-Studio`
- **Protected working principle:** Read and verify first; make scoped changes only after the evidence and acceptance criteria are clear.
- **Main branch at baseline capture:** `main`
- **Main commit at baseline capture:** `835301d545650f9af1b30231a91454ba6a5bab87`
- **Recovery branch inspected:** `recovery/alex-studio-source-import`
- **Recovery commit inspected:** `f2471ecd71dc022629776bc32ea15ddee2b9ac54`
- **Local Termux state:** Not verified in this review. Commands pasted into Termux returned no output, so local branch, working-tree changes, installed dependencies, and local test results remain unknown.

## 1. Purpose of this document

This file records the current project intent, the inspected repository references, the initial inventory, the known gaps, and a controlled build-and-acceptance process. It is the project checkpoint to resume from after a pause.

This document does **not** assert that the application is complete, secure, deployed, or accepted. A file existing is not proof that its behavior works. A past test result is not proof about a different commit or local working tree.

## 2. Change-control rules

1. `main` is the baseline/reference branch. Do not make direct implementation changes to `main` as part of ordinary work.
2. Start scoped work on a named branch from a recorded base commit.
3. Inspect before editing. Identify the file, observed defect, evidence, intended fix, and acceptance test before implementation.
4. Do not delete, overwrite, or broadly refactor files just because they look incomplete. Establish the reason and impact first.
5. Do not merge a pull request or declare a stage accepted without explicit owner approval and evidence.
6. Each stage must have a clear scope, a testable acceptance gate, and a recorded result. A failed gate stays open; do not silently advance.
7. Preserve existing user work. Never assume the Termux working tree matches GitHub until status and commit comparisons prove it.
8. Never include API keys, passwords, tokens, private user data, or secret values in source control or reports.
9. Treat generated code and project files as untrusted input. The user must review proposed changes before they are applied.
10. Changes to the product goals or this baseline require Ali's explicit approval. Record approved changes with date, rationale, and the affected stage; do not silently reinterpret the goals.

## 3. Product goal

Alex Studio is intended to be a personal, AI-assisted web-development studio. The AI proposes a plan and file changes; the user remains the decision-maker and must review and approve changes before they are applied.

### Core product goals

- Create, list, open, update, and delete projects within a clearly bounded workspace.
- Begin with static HTML, CSS, and JavaScript projects; do not assume support for arbitrary frameworks or unrestricted server-side projects in the initial scope.
- Allow the user to discuss a requested change with an AI provider configured by environment variables.
- Show proposed file operations and meaningful before/after diffs before any write is approved.
- Require explicit approval before applying proposed changes; rejection must leave target files unchanged.
- Maintain backups and a verifiable history so that changes can be inspected and safely reversed.
- Preview project output in an isolated context, with browser security controls tested rather than merely described in the UI.
- Validate file paths and keep file operations inside the designated workspace, including protection against symlink/path escapes.
- Provide clear errors, bounded request sizes, sensible rate/cost controls, and safe handling of provider failures.
- Provide automated tests, a repeatable build, and a documented acceptance record.
- Support exporting a project in a portable form, with export behavior verified by tests.
- Keep credentials server-side and out of browser bundles, logs, generated files, and repository history.

### Product decisions that remain unapproved unless Ali confirms them

The current README contains proposed decisions about local-only operation, no database/cloud, local Git history, ZIP export, and a suggested AI budget. These are proposals in the inspected decision log, not automatically final decisions. In particular, no exact dollar limit is considered approved by this document. Confirm or revise these decisions before the relevant implementation stage.

## 4. Repository baseline and evidence

### References inspected

- `main` at `835301d545650f9af1b30231a91454ba6a5bab87`
- `recovery/alex-studio-source-import` at `f2471ecd71dc022629776bc32ea15ddee2b9ac54`

The recovery branch was inspected for source inventory and selected implementation details. The local Termux checkout was not successfully inspected in this session. Do not assume it equals either GitHub reference.

### Current source inventory observed on the recovery branch

- App routes: `src/app/page.tsx`, `chat/page.tsx`, `editor/page.tsx`, `preview/page.tsx`, `projects/page.tsx`, `review/page.tsx`, `layout.tsx`, `globals.css`.
- API routes: `src/app/api/ai/chat/route.ts`, `src/app/api/files/read/route.ts`, `src/app/api/files/apply/route.ts`, `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`.
- Components: `src/components/DiffEditor.tsx`.
- Libraries: `src/lib/aiClient.ts`, `checksum.ts`, `fileOps.ts`, `projectOps.ts`.
- Project setup: `package.json`, `package-lock.json`, Next.js, TypeScript, and ESLint configuration.
- Test-like files observed: `test_checksum.mjs`, `test_fileOps.mjs`.

This is the observed inventory for the inspected recovery ref, not yet a verified inventory of the local checkout or the final selected source branch.

## 5. Initial engineering findings to verify

These are code-review observations from selected files, not proof that an exploit has occurred:

1. The recovery branch's root page appears to be the default Next.js page rather than the finished product dashboard.
2. The editor and review experiences include static/demo change data; end-to-end editing of real project files has not been proven.
3. `aiClient.ts` returns a mock response when `AI_API_KEY` is missing; a visible chat UI therefore does not prove a real AI connection.
4. The chat API validates basic message fields but needs review for request-size/message-count limits, accepted roles, rate limiting, and safe error responses.
5. File read/write API routes need an explicit authentication/authorization assessment before use beyond a trusted local environment.
6. File path validation needs tests for symlinks and resolved-path escapes, in addition to traversal strings.
7. File writes, backup naming, concurrent writes, rollback, and failure handling need deterministic tests.
8. Project creation interpolates user-provided names into HTML; escape content correctly before inserting user data into generated markup.
9. Project identifiers and deletion scope need validation so a project operation cannot escape its intended workspace.
10. The preview's `sandbox` attribute is a useful control, but CSP behavior must be verified from actual response headers and browser tests. UI text alone is not evidence.
11. Provider error details should not be blindly returned to users if they can reveal sensitive information.
12. The test files must be run on the selected commit; their existence alone is not a passing test result.

## 6. Stage plan and acceptance gates

The stage labels below are a proposed work plan. They become completed only after their gates are met and the result is recorded.

### A0 — Baseline and source reconciliation
- Record local path, current branch, working-tree status, remotes, recent commits, and available tests.
- Compare the local checkout with the selected GitHub base and identify uncommitted user work.
- Inspect the main and recovery branches and decide which source is authoritative.
- Acceptance: no unknown local changes are overwritten; the owner-approved base commit and scope are recorded.

### A1 — Security and filesystem boundary
- Review API access, authorization, path validation, symlinks, workspace boundaries, backups, concurrent writes, and delete operations.
- Add focused tests for both allowed and rejected cases.
- Acceptance: all relevant tests pass; unsafe operations are denied; errors do not disclose secrets.

### A2 — Product shell and navigation
- Define the final product dashboard and screen map; replace the default starter experience only after the design and acceptance criteria are agreed.
- Acceptance: every navigation destination exists, behaves correctly, and is responsive.

### A3 — Project and file lifecycle
- Verify create/list/open/read/update/delete operations against actual workspace projects.
- Acceptance: project isolation, metadata consistency, path boundaries, and failure recovery are tested.

### A4 — Editor, diff, and approval workflow
- Connect editor and diff views to actual project files.
- Require explicit approval before writes; verify rejection leaves file bytes and checksums unchanged.
- Acceptance: create/modify/delete proposals are reviewable, accurately diffed, and safely applied or rejected.

### A5 — AI provider integration
- Verify configuration, server-side secret handling, message validation, request limits, provider errors, usage accounting, and cost controls.
- Acceptance: configured provider requests work; missing configuration is clearly identified as mock/development mode; no secrets leak to the client.

### A6 — Isolated preview and browser validation
- Verify sandbox behavior, CSP headers, resource loading policy, navigation restrictions, and representative hostile HTML/JavaScript.
- Acceptance: browser tests demonstrate the documented security boundaries.

### A7 — History, rollback, and export
- Verify backup integrity, change history, rollback, and portable project export.
- Acceptance: restoration reproduces the expected content and export can be opened and checked independently.

### A8 — End-to-end acceptance and release decision
- Run lint, type checks, unit/integration tests, browser tests, production build, and applicable security checks on the exact candidate commit.
- Review responsive behavior, accessibility basics, error states, and documented limitations.
- Acceptance: evidence is attached to the candidate commit and Ali explicitly approves the release decision.

## 7. Verification record at document creation

- GitHub source inventory and selected source files: inspected.
- GitHub main ref: observed at `835301d545650f9af1b30231a91454ba6a5bab87`.
- Recovery ref: observed at `f2471ecd71dc022629776bc32ea15ddee2b9ac54`.
- Termux commands: no usable output was returned; local state remains unverified.
- Tests/build/lint run during this documentation action: none.
- Production readiness: not established.
- Stage status: A0 remains open until local/source reconciliation is completed.
- Changes to application code: none in this documentation action.

## 8. Next action

Complete A0 using a reliable read-only inspection of the Termux checkout and compare its branch/commit and working tree with the selected GitHub source. If Termux commands continue returning no output, capture a screenshot or diagnose terminal input/output before drawing conclusions. Do not overwrite or reset the checkout to make it match GitHub.

## 9. Change log

- 2026-10-27 — Initial baseline document drafted from the inspected GitHub refs and selected source files. No application code changed. Product decisions listed as proposals remain subject to Ali's explicit confirmation.
