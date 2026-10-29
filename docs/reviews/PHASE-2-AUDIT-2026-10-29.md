# Phase 2 Technical Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit scope:** Phase 2 only — AI build flow, file mutation safety, dependency hygiene, source export, and CI evidence.  
**Baseline revision:** `1eb1f84961a7e4ef1c45c6eb1a413108887cff7b`  
**Status:** IN PROGRESS — targeted hardening is proposed in PR #58; do not treat the phase as closed until its checks and the live-provider proof are successful.

## Executive summary

- Standard CI passed on the baseline revision (workflow run [40860827698](https://github.com/AligasSRM/Alex-Studio/actions/runs/40860827698)).
- The dependency audit reported **0 critical, 0 high, 0 moderate, and 6 low** vulnerabilities. The CI job records this report but intentionally does not fail solely because of the low findings.
- The live OpenAI provider proof previously returned **HTTP 503** (`AI provider is busy; try again later`), so a successful real-provider call has not yet been demonstrated.
- The tracked source ZIP was a stale snapshot and did not match `main`. PR #58 removes the stale binary and changes distribution to a validated ZIP artifact generated from the exact checked-out commit.
- Three legacy file mutation endpoints parsed JSON without an explicit request-body cap. PR #58 adds a shared streaming parser with a 1,100,000-byte cap and tests for malformed and oversized payloads.

## Findings and disposition

| Area | Finding | Severity / status | Disposition |
|---|---|---|---|
| Source archive | Committed ZIP was not a faithful snapshot of current `main`; archive omitted a key AI build route and contained files not present in the current tree. | High-confidence correctness issue | Replace the committed snapshot with an artifact generated from the exact tested commit; validate ZIP structure and deny sensitive paths. |
| File APIs | `app/api/files/route.ts`, `app/api/files/apply/route.ts`, and `app/api/files/write/route.ts` used `request.json()` without an explicit body-size bound. | Security hardening | PR #58 adds bounded streaming JSON parsing before validation and mutation. Existing local-origin and explicit-approval checks remain in place. |
| AI build approval | AI build route requires explicit approval to generate a draft; apply route requires explicit approval plus a current server verification proof and matching base hashes. | Positive control, code-level | Retain; passing unit tests does not replace real provider proof. |
| File paths | Shared path validation rejects traversal, absolute paths, hidden segments, and symlink escapes; file writes also validate text size and create backups. | Positive control, code-level | Retain; runtime race and host-level isolation are not certified by this review. |
| Dependency audit | npm audit reported six low-severity entries in the Jest dependency chain: `@jest/core`, `deepmerge`, `jest`, `jest-cli`, `jest-config`, and `ts-jest`. The reported deepmerge advisory is GHSA-gcqx-w48m-w2h4. | Open, low severity | The repository pins `deepmerge` 4.3.1 and verifies a local `__proto__` mitigation after install; this is a compensating control, not a clean upstream audit. Do not use `npm audit fix --force` without a tested compatibility plan. |
| Live provider | The real integration test previously failed with HTTP 503 from the provider. | Open — proof missing | Retry through the existing protected GitHub Actions workflow and require a successful result; never expose the API key in logs or chat. |
| CI coverage | Baseline CI passes unit tests, typecheck, lint, build, and browser acceptance. Its dependency audit is informational for low findings. | Partial | Recheck the new PR run and source-archive step; the passing baseline is not evidence of a clean audit or a successful live-provider call. |
| Unrelated incoming uploads | PR #54 contains an HTML cookie-check page rather than a source ZIP; PR #55 has no changed filenames in the observed listing. | Not approved | Do not merge these uploads as phase-2 source without a fresh content review. |

## Phase 2 acceptance gates

Do not mark Phase 2 complete until all are true:

1. CI passes on the final commit, including the bounded-body tests and source-archive creation/validation.
2. The generated source artifact corresponds to the tested commit and contains no `.env*`, private-key files, `.git/`, `node_modules/`, `.next/`, `.alex/`, or workspace data.
3. A real OpenAI provider integration run succeeds through `/api/ai/build`, validates the returned draft and usage, and proves the original project file remains unchanged.
4. The low-severity dependency report is reviewed and documented; no high, critical, or moderate findings are present. Any decision to retain a low finding must include its mitigation and residual risk.
5. No claim of remote-deployment safety is made from localhost-only controls; public deployment remains outside the scope of this Phase 2 audit.

## Evidence links

- Baseline CI: https://github.com/AligasSRM/Alex-Studio/actions/runs/40860827698
- Live-provider proof workflow: https://github.com/AligasSRM/Alex-Studio/actions/workflows/openai-provider-proof.yml
- Phase 2 hardening PR: https://github.com/AligasSRM/Alex-Studio/pull/58
