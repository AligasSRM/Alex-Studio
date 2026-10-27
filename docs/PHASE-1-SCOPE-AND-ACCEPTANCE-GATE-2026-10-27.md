# Alex Studio — Phase 1 Scope and Acceptance Gate

- Date: 2026-10-27
- Repository: `AligasSRM/Alex-Studio`
- Base: `main`
- Work branch: `phase/1-acceptance-gate-audit-2026-10-27`
- Status: **AUDIT RECORDED — IMPLEMENTATION NOT YET ACCEPTED**
- Scope: define an evidence-based Phase 1 gate from the current repository baseline. This document does not authorize deployment or close first-release acceptance.

## 1. Read-only findings

Evidence inspected on `main`:
- `package.json`: Next.js 15.5.28, React/React DOM 19.2.9; available scripts are dev, build, lint, Jest tests, Playwright E2E, and typecheck. No AI-provider SDK is declared in the manifest.
- `app/api/files/apply/route.ts`: local-request checks guard project file reads and writes; POST requires `approved === true`; invalid inputs and failed writes return explicit errors. This route is file read/apply functionality, not an AI-provider endpoint.
- `docs/reviews/PHASE-0-ACCEPTANCE-TEST-BASELINE-2026-10-27.md`: Phase 0 gate is recorded CLOSED/PASS for P0-ACC-001–017 on tested commit `8ddef4083a17c578fc713cc93d640a5326bd4229`, CI run `40567364737`. The document explicitly says this is not release approval and records 4 dependency advisories at that earlier install.
- Latest follow-up supplied by the owner: Dependabot is enabled and its UI reports zero open Dependabot alerts. This is evidence for the current Dependabot alert list only, not a substitute for other security checks.

This is a scoped source inspection, not a full repository-wide implementation audit. Items below are therefore marked **not evidenced / must verify**, rather than claiming they are definitely absent.

## 2. Phase 1 workstreams and acceptance evidence

| ID | Workstream | Current evidence | Required acceptance evidence |
|---|---|---|---|
| P1-ACC-01 | AI-provider integration | No provider SDK in `package.json`; no AI route found in the inspected path | Server-only provider adapter; API key read only from server environment; no key in browser bundles, logs, project files, or ZIP exports; mock-based success/error/timeout tests |
| P1-ACC-02 | Request rate limiting | Not evidenced in the inspected route/package | Deterministic tests proving allowed requests, limit exceeded response (429), window reset, and isolation by the documented local scope; document in-memory limits and restart behavior |
| P1-ACC-03 | Error handling | File route returns explicit JSON errors for several invalid requests and caught file failures | Tests for malformed JSON, oversized payloads, provider errors, timeouts, and sanitized client messages; no secret/provider internals leaked |
| P1-ACC-04 | Secret protection | Prior baseline says local-only and no user authentication; Dependabot is separate from secret scanning | Verify GitHub secret scanning/push protection settings and scan results; test that keys are excluded from exports and never rendered to client; record exact evidence |
| P1-ACC-05 | Usage/cost accounting | Not evidenced in inspected manifest/route | Persist per-project and monthly token/cost records; tests for aggregation, missing usage metadata, currency rounding, and month boundaries |
| P1-ACC-06 | Monthly budget warning | Not evidenced in inspected manifest/route | Configurable default threshold, warning-only behavior, boundary tests, and explicit confirmation that reaching threshold does not silently disable work |
| P1-ACC-07 | Performance thresholds | Prior baseline says thresholds remain outstanding | Repeatable tests measuring API response under 10 seconds and file loading under 2 seconds; report sample size, environment, and results |
| P1-ACC-08 | Dependency/security regression | Owner reports zero open Dependabot alerts; Phase 0 baseline contains an older install-advisory record | Fresh clean install and audit against the exact candidate commit; record package-lock consistency, advisory count/severity, and all CI results |

## 3. Required implementation order

1. Verify current tree, lockfile, existing routes, and tests before editing.
2. Implement server-side AI-provider boundary and secret-handling tests.
3. Add bounded rate limiting and malformed/oversized-request handling.
4. Add usage/cost records and warning-only monthly threshold.
5. Add performance and security regression tests.
6. Run clean install, Jest, typecheck, lint, production build, Playwright, and dependency audit on the exact candidate commit.
7. Review the evidence matrix before any merge decision.

## 4. Guardrails

- Keep all work on this branch; do not modify `main` directly.
- Keep the prototype local-only. Do not deploy publicly; the current baseline says there is no user authentication.
- No AI request may run before explicit user approval of the proposed changes.
- Never expose provider keys to the browser or preview sandbox.
- Do not claim a criterion passes without a recorded test result tied to the exact commit.
- Do not treat this scope document as Phase 1 completion, first-release approval, or authorization to deploy.

## 5. Decision

**Phase 1 is prepared as a separate acceptance-gated workstream.** The next engineering action is implementation on this branch, beginning with a repository-wide read-only inspection of the current AI, security, file, export, and test paths. The checks listed as “not evidenced” require source inspection and tests before they can be classified as implemented or missing.
