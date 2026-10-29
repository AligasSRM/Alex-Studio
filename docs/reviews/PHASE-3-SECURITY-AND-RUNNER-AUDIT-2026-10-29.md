# Phase 3 Security and Execution Runner Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit branch:** `phase/3-finalize-runner-audit-2026-10-29`  
**Baseline:** `main` at `1067ecad31b579b5bbc7aae06b9259e43426ed4d`  
**Scope:** The Phase 3 checklist previously discussed: isolated execution of generated projects, dependency installation, evidence reporting, isolation/resource controls, and post-change CI/Docker proof.  
**Disposition:** Final Phase 3 verification recorded against `main` commit `85878beea5aa6cbc4ad6e4a848de56a7502e5dbb`; this update adds explicit Docker-daemon-unavailable regression coverage. Close Phase 3 only after this report and test change pass CI and real-Docker integration on the same candidate commit.

## Checklist and evidence

| Checklist item | Repository evidence | Audit status | Required disposition |
|---|---|---|---|
| Define scope and acceptance evidence | This audit lists the checks and the evidence needed. | PASS (documentation) | Keep this matrix as the phase gate. |
| Run generated-project commands in an isolated environment | `lib/ai-command-runner.ts` invokes a pinned Playwright Docker image; `--network none`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`, unprivileged UID, memory/CPU/PID limits, tmpfs workspace. | IMPLEMENTED; runtime proof required | Require Docker integration on the exact candidate commit. |
| Dependency installation safety | Requires `package-lock.json`; accepts npm lockfile v2/v3; installs with `npm ci --offline --ignore-scripts`; no dependency download is intended. | IMPLEMENTED; cache trust remains a precondition | Only use a pre-populated trusted cache; do not mount secrets or use an untrusted cache. |
| Record command results | Runner records command status, timestamps, exit code, bounded output, truncation, runtime, package manager, and lockfile hash. | IMPLEMENTED | Keep missing scripts as NOT RUN/FAIL and missing runtime/cache/image as UNAVAILABLE; never infer success from a browser smoke test. |
| Isolation and resource limits | Docker invocation constrains network, filesystem, capabilities, privilege escalation, memory, CPU, PID count, and execution time; source and cache mounts are read-only. | IMPLEMENTED in code; not a complete host-security certification | Docker daemon and host kernel remain trusted components. Do not claim protection from host/kernel compromise or all resource-exhaustion modes. |
| Prevent secrets entering the runner | Real-Docker regression test sets `ALEX_STUDIO_HOST_ONLY_SENTINEL` on the host and verifies the generated command succeeds only when that variable is absent. | VERIFIED by real Docker test on `85878beea5aa6cbc4ad6e4a848de56a7502e5dbb` | Keep the regression test in the Docker workflow. |
| Prove no project changes leak back to the host | Real-Docker regression test attempts to overwrite a workspace sentinel and verifies original host-file bytes remain identical. | VERIFIED by real Docker test on `85878beea5aa6cbc4ad6e4a848de56a7502e5dbb` | Keep the regression test in the Docker workflow. |
| Verify cleanup after execution and timeout | Real Docker integration asserts cleanup after success, timeout, and non-zero exit. | VERIFIED by passing Docker integration run on `85878beea5aa6cbc4ad6e4a848de56a7502e5dbb` | Keep cleanup assertions enabled in CI. |
| CI on the same revision | Main CI and Docker Integration both completed successfully on merge commit `85878beea5aa6cbc4ad6e4a848de56a7502e5dbb`. | VERIFIED on exact same `main` commit | Preserve both workflow gates for future runner changes. |
| Validate actual execution versus static/browser checks | Existing acceptance-gate documentation states static preflight and browser smoke tests do not prove generated-project build/test correctness. | PASS (limitation documented) | Preserve separate statuses; do not mark unexecuted project scripts as PASS. |

## Concrete findings

1. **The isolated runner is present, not hypothetical.** Its implementation applies network isolation, read-only root filesystem, dropped Linux capabilities, non-root UID, no-new-privileges, and bounded memory/CPU/PIDs. Dependency install is offline and lifecycle scripts are disabled.
2. **The repository has real Docker integration tests** for a successful command run, denied network access via DNS lookup, timeout handling, and container cleanup. These tests are opt-in locally and run through `.github/workflows/docker-integration.yml`.
3. **Host environment, host-file, and Docker-unavailable outcomes have explicit regression coverage.** Real-Docker tests verify host-only environment isolation, byte-identical host files after attempted writes, and cleanup after normal, timeout, and non-zero command outcomes. A unit regression test simulates a Docker daemon connection failure and verifies it returns `UNAVAILABLE`, distinct from a generated command returning a non-zero exit code (`FAIL`).
4. **A passing CI job is not a host-isolation certification.** Docker daemon access, the host kernel, and the trusted runner image/cache remain part of the trusted computing base. This design is not a substitute for a separate hardened VM for hostile multi-tenant workloads.
5. **No OpenAI-specific provider tests are part of this audit.** The project-owner decision in `PHASE-2-PROVIDER-DECISION-ADDENDUM-2026-10-29.md` remains in force; Groq is the accepted provider for Phase 2.

## Acceptance gate to close Phase 3

- [x] Unit tests passed on merge commit `85878beea5aa6cbc4ad6e4a848de56a7502e5dbb` — [CI run 40877392173](https://github.com/AligasSRM/Alex-Studio/actions/runs/40877392173). The new daemon regression test must pass on the final candidate before closure.
- [x] Type check, lint, production build, browser acceptance, and archive validation passed on the same commit — [CI run 40877392173](https://github.com/AligasSRM/Alex-Studio/actions/runs/40877392173).
- [x] Real Docker integration passed on the same commit — [Docker Integration run 40877392043](https://github.com/AligasSRM/Alex-Studio/actions/runs/40877392043). The final candidate must rerun this workflow.
- [x] Regression tests verify host-only environment isolation and byte-identical host project files after attempted writes.
- [x] Existing tests distinguish success, non-zero failure, timeout, unavailable offline cache, missing/unpinned runner image, and missing required scripts. A new daemon-unavailable regression test is added in this candidate and must pass before closure.
- [x] Real-Docker cleanup assertions cover normal completion, timeout, and non-zero exit.
- [x] Preserve the trusted-computing-base limitation; do not claim full host/kernel isolation.

**Current decision:** The remaining outcome-classification gap is addressed by a new regression test simulating a Docker daemon connection failure and asserting `UNAVAILABLE`. Phase 3 closure is contingent on both CI and real-Docker workflows passing on the same final PR head SHA; record those exact run URLs before merging this audit.
