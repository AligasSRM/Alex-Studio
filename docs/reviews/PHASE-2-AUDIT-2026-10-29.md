# Phase 2 Technical Audit — 2026-10-29 (Revalidation)

**Repository:** `AligasSRM/Alex-Studio`  
**Scope:** Phase 2 only — AI build/apply flow, file mutation safety, dependency hygiene, source export, and CI evidence.  
**Audited main revision:** `22b4c53c3053d55468e0d764debe4c5770ba88bd`  
**Status:** **IN PROGRESS — CI and dependency audit pass; live OpenAI provider proof remains blocked by repeated HTTP 503 responses.** The additional AI-apply streaming body-limit fix in this revalidation branch must pass CI before merge. Do not mark Phase 2 closed until the real-provider acceptance gate succeeds or the project owner explicitly accepts a documented external blocker.

## Evidence-based summary

- Main CI passed on the audited revision: [run 40864894574](https://github.com/AligasSRM/Alex-Studio/actions/runs/40864894574).
- Docker runner integration passed on the same revision: [run 40864894589](https://github.com/AligasSRM/Alex-Studio/actions/runs/40864894589).
- The CI-uploaded `npm-audit-report.json` reports **0 critical, 0 high, 0 moderate, and 0 low vulnerabilities** (663 dependencies represented in the audit metadata). Artifact: `npm-audit-report` from run 40864894574.
- The repository vendors a reviewed, MIT-licensed `deepmerge` implementation as local package version `4.3.2`, blocks `__proto__` keys on both source and target copy paths, and includes regression tests. CI verifies the expected package identity and guard; this is a maintained local patch, not an upstream release claim.
- The source ZIP is generated from the exact checked-out commit and validated in CI; no stale source ZIP is tracked in `main`. The archive step passed in run 40864894574.
- The file-write, file-apply, and file-write-alias endpoints use the shared streaming JSON parser with a 1,100,000-byte limit.
- The AI build endpoint uses the streaming parser with a 24 KiB limit, explicit approval, bounded prompt/context/file output, protected-path checks, and draft-only behavior.
- Revalidation found that `app/api/ai/apply/route.ts` still relied on `Content-Length` for its 3 MiB request limit before calling `request.json()`. A request without a trustworthy length could be buffered before the later 2 MiB per-batch file-content validation. This branch replaces that check with streaming bounded parsing and adds regression tests; CI must pass before this item is marked complete.
- The real OpenAI provider proof was retried after the previous failure and again returned **HTTP 503: `AI provider is busy; try again later`** after the bounded retries. Latest retry: [run 40863771244, latest attempt](https://github.com/AligasSRM/Alex-Studio/actions/runs/40863771244). The workflow confirms the secret is configured without printing its value. The generic 503 message does not establish whether the cause is provider rate limiting, temporary service pressure, or another provider-side condition. No successful real-provider response has been proven yet.

## Findings and disposition

| Area | Finding | Current status | Disposition |
|---|---|---|---|
| Dependency audit | Six previous low findings were associated with the Jest/deepmerge dependency chain and advisory GHSA-gcqx-w48m-w2h4. | **Resolved in main; audit reports zero findings** | Local reviewed `deepmerge` patch, dependency lock update, prototype-pollution tests, and CI provenance checks are merged. Revisit when a suitable upstream fixed release is available. |
| File mutation APIs | Three file mutation endpoints lacked a streaming request-body cap. | **Resolved in main** | Shared streaming JSON parser; 1,100,000-byte maximum; malformed and oversized body tests. |
| AI build request | Previously could read a large body before validating prompt input. | **Resolved in main** | 24 KiB streaming body cap; oversized and malformed body regression tests. |
| AI apply request | Previous cap trusted `Content-Length`; body parsing used `request.json()`. | **Fix proposed in this revalidation branch; CI pending** | Apply streaming parser with 3 MiB total JSON limit; tests for oversized bodies without `Content-Length` and malformed JSON. |
| Draft approval and stale writes | Applying a generated draft requires explicit approval, a current server verification proof, canonical paths, and matching base hashes; rollback is attempted if a batch write fails. | **Code-level controls present; tests pass on audited main** | Retain and continue testing. These checks do not by themselves certify isolation against host-level races. |
| Path and file safety | Path validation rejects traversal and symlink escapes; protected paths and file-content size limits are enforced. | **Code-level controls present; CI passed on audited main** | Retain. Do not infer production or remote-host isolation from localhost-only request checks. |
| Source archive | Previously tracked ZIP did not faithfully represent current source. | **Resolved in main** | Archive generated from tested commit, ZIP validated, sensitive/forbidden paths excluded, and CI artifact uploaded. |
| Standard CI | Unit tests, type check, lint, production build, browser acceptance, and archive creation. | **Passed on audited main** | Re-run after the AI-apply hardening PR merges. |
| Docker integration | Runner integration test. | **Passed on audited main** | Re-run after the AI-apply hardening PR merges. |
| Real OpenAI provider | Live build-route test returns HTTP 503 after retries. | **OPEN — acceptance gate not met** | Investigate provider-side limits/availability and retry via the protected workflow. Do not weaken or skip the live test, and do not expose credentials. |

## Phase 2 acceptance gates

Phase 2 is not complete until all of the following are true:

1. CI passes on the final main commit, including AI-apply streaming body-limit tests, unit tests, type check, lint, production build, browser acceptance, and source archive validation.
2. The Docker runner integration passes on the same final commit.
3. The dependency audit remains at zero findings; any local vendored security patch is clearly documented and regression-tested.
4. The source archive is produced from the exact tested commit and contains no secrets, `.git/`, `node_modules/`, `.next/`, `.alex/`, or workspace data.
5. A real OpenAI integration call succeeds through `/api/ai/build`, validates the returned draft and usage, and proves the original project file remains unchanged.
6. No claim of remote-deployment safety is made from localhost-only controls; public deployment remains outside the scope of this Phase 2 audit.

## Evidence links

- Main CI after dependency remediation: https://github.com/AligasSRM/Alex-Studio/actions/runs/40864894574
- Docker integration after dependency remediation: https://github.com/AligasSRM/Alex-Studio/actions/runs/40864894589
- Latest retried live OpenAI proof (still failing HTTP 503): https://github.com/AligasSRM/Alex-Studio/actions/runs/40863771244
- Dependency remediation PR: https://github.com/AligasSRM/Alex-Studio/pull/60
