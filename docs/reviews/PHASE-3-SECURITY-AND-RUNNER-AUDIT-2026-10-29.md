# Phase 3 Security and Execution Runner Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit branch:** `phase/3-runner-audit-hardening-2026-10-29`  
**Baseline:** `main` at `1067ecad31b579b5bbc7aae06b9259e43426ed4d`  
**Scope:** The Phase 3 checklist previously discussed: isolated execution of generated projects, dependency installation, evidence reporting, isolation/resource controls, and post-change CI/Docker proof.  
**Disposition:** Evidence updated after merge commit `ba4d34fd427fb5ca7b70ec4850d3d52b1190b30f`. CI and real-Docker integration passed on that exact `main` commit; remaining acceptance items are tracked below and Phase 3 is not declared closed until all are evidenced.

## Checklist and evidence

| Checklist item | Repository evidence | Audit status | Required disposition |
|---|---|---|---|
| Define scope and acceptance evidence | This audit lists the checks and the evidence needed. | PASS (documentation) | Keep this matrix as the phase gate. |
| Run generated-project commands in an isolated environment | `lib/ai-command-runner.ts` invokes a pinned Playwright Docker image; `--network none`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`, unprivileged UID, memory/CPU/PID limits, tmpfs workspace. | IMPLEMENTED; runtime proof required | Require Docker integration on the exact candidate commit. |
| Dependency installation safety | Requires `package-lock.json`; accepts npm lockfile v2/v3; installs with `npm ci --offline --ignore-scripts`; no dependency download is intended. | IMPLEMENTED; cache trust remains a precondition | Only use a pre-populated trusted cache; do not mount secrets or use an untrusted cache. |
| Record command results | Runner records command status, timestamps, exit code, bounded output, truncation, runtime, package manager, and lockfile hash. | IMPLEMENTED | Keep missing scripts as NOT RUN/FAIL and missing runtime/cache/image as UNAVAILABLE; never infer success from a browser smoke test. |
| Isolation and resource limits | Docker invocation constrains network, filesystem, capabilities, privilege escalation, memory, CPU, PID count, and execution time; source and cache mounts are read-only. | IMPLEMENTED in code; not a complete host-security certification | Docker daemon and host kernel remain trusted components. Do not claim protection from host/kernel compromise or all resource-exhaustion modes. |
| Prevent secrets entering the runner | Real-Docker regression test sets `ALEX_STUDIO_HOST_ONLY_SENTINEL` on the host and verifies the generated command succeeds only when that variable is absent. | VERIFIED by real Docker test on `ba4d34fd427fb5ca7b70ec4850d3d52b1190b30f` | Keep the regression test in the Docker workflow. |
| Prove no project changes leak back to the host | Real-Docker regression test attempts to overwrite a workspace sentinel and verifies original host-file bytes remain identical. | VERIFIED by real Docker test on `ba4d34fd427fb5ca7b70ec4850d3d52b1190b30f` | Keep the regression test in the Docker workflow. |
| Verify cleanup after execution and timeout | Real Docker integration job passed, including existing success/timeout cleanup assertions. | VERIFIED by passing Docker job; run ID `40875673466` | Keep cleanup assertions enabled in CI. |
| CI on the same revision | Main CI run `40875673436` and Docker Integration run `40875673466` both passed on merge commit `ba4d34fd427fb5ca7b70ec4850d3d52b1190b30f`. | VERIFIED on the exact same `main` commit | Preserve the two workflow gates for future runner changes. |
| Validate actual execution versus static/browser checks | Existing acceptance-gate documentation states static preflight and browser smoke tests do not prove generated-project build/test correctness. | PASS (limitation documented) | Preserve separate statuses; do not mark unexecuted project scripts as PASS. |

## Concrete findings

1. **The isolated runner is present, not hypothetical.** Its implementation applies network isolation, read-only root filesystem, dropped Linux capabilities, non-root UID, no-new-privileges, and bounded memory/CPU/PIDs. Dependency install is offline and lifecycle scripts are disabled.
2. **The repository has real Docker integration tests** for a successful command run, denied network access via DNS lookup, timeout handling, and container cleanup. These tests are opt-in locally and run through `.github/workflows/docker-integration.yml`.
3. **The host-environment and host-file proof gaps are now covered.** Two real-Docker regression tests verify that a host-only sentinel is absent inside generated commands and attempted workspace writes leave original host-file bytes unchanged. Both main CI and real Docker integration passed after merge; run IDs are recorded in the acceptance gate below.
4. **A passing CI job is not a host-isolation certification.** Docker daemon access, the host kernel, and the trusted runner image/cache remain part of the trusted computing base. This design is not a substitute for a separate hardened VM for hostile multi-tenant workloads.
5. **No OpenAI-specific provider tests are part of this audit.** The project-owner decision in `PHASE-2-PROVIDER-DECISION-ADDENDUM-2026-10-29.md` remains in force; Groq is the accepted provider for Phase 2.

## Acceptance gate to close Phase 3

- [x] Unit tests pass on merge commit `ba4d34fd427fb5ca7b70ec4850d3d52b1190b30f` — [CI run 40875673436](https://github.com/AligasSRM/Alex-Studio/actions/runs/40875673436).
- [x] Type check, lint, production build, browser acceptance, and archive validation pass on the same commit — [CI run 40875673436](https://github.com/AligasSRM/Alex-Studio/actions/runs/40875673436).
- [x] Real Docker integration passes on the same commit — [Docker Integration run 40875673466](https://github.com/AligasSRM/Alex-Studio/actions/runs/40875673466).
- [x] Regression tests pass for host-only environment isolation and byte-identical host project files after attempted writes — Docker Integration run `40875673466`.
- [ ] Confirm success, failure, timeout, unavailable runtime/cache, and missing-script outcomes are distinct and evidenced with explicit regression coverage.
- [x] Docker integration cleanup assertions pass after normal completion and timeout — run `40875673466`.
- [x] Keep the documented trusted-computing-base limitation; do not claim full host/kernel isolation.

**Current decision:** CI and real-Docker verification are green on the same merged `main` commit. Phase 3 remains open only for the remaining explicit outcome/edge-case coverage item above; do not mark the entire phase closed until it is implemented or supported by clear existing test evidence.
