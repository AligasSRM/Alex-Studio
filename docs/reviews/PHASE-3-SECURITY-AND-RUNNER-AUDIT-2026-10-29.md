# Phase 3 Security and Execution Runner Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit branch:** `phase/3-finalize-runner-audit-2026-10-29`  
**Baseline:** `main` at `1067ecad31b579b5bbc7aae06b9259e43426ed4d`  
**Scope:** The Phase 3 checklist previously discussed: isolated execution of generated projects, dependency installation, evidence reporting, isolation/resource controls, and post-change CI/Docker proof.  
**Disposition:** PHASE 3 CLOSED. PR #69 is merged. Main CI and real-Docker integration both passed on the exact PR head commit `fe867319e4afa0cca70f2f37a847f2200c1d7987` (CI run 40878971790; Docker Integration run 40878972379). This closure retains the documented trusted-computing-base limitation and does not claim complete host/kernel isolation.

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

- [x] Unit tests passed on merge commit `85878beea5aa6cbc4ad6e4a848de56a7502e5dbb` — [CI run 40877392173](https://github.com/AligasSRM/Alex-Studio/actions/runs/40877392173). The new daemon regression test passed on candidate commit `03642aef691931c8829ff9d1272163fa07b637b8` — [CI run 40878651086](https://github.com/AligasSRM/Alex-Studio/actions/runs/40878651086).
- [x] Type check, lint, production build, browser acceptance, and archive validation passed on the same commit — [CI run 40877392173](https://github.com/AligasSRM/Alex-Studio/actions/runs/40877392173).
- [x] Real Docker integration passed on the same commit — [Docker Integration run 40877392043](https://github.com/AligasSRM/Alex-Studio/actions/runs/40877392043). The final candidate passed real-Docker integration — [Docker Integration run 40878651094](https://github.com/AligasSRM/Alex-Studio/actions/runs/40878651094).
- [x] Regression tests verify host-only environment isolation and byte-identical host project files after attempted writes.
- [x] Existing tests distinguish success, non-zero failure, timeout, unavailable offline cache, missing/unpinned runner image, and missing required scripts. The Docker daemon-unavailable regression test passed on candidate commit `03642aef691931c8829ff9d1272163fa07b637b8` — [CI run 40878651086](https://github.com/AligasSRM/Alex-Studio/actions/runs/40878651086).
- [x] Real-Docker cleanup assertions cover normal completion, timeout, and non-zero exit.
- [x] Preserve the trusted-computing-base limitation; do not claim full host/kernel isolation.

**Final decision — CLOSED:** The daemon-unavailable regression distinguishes infrastructure failure (`UNAVAILABLE`) from a generated command's non-zero exit (`FAIL`). PR #69 is merged, and both required workflows passed on its exact head commit `fe867319e4afa0cca70f2f37a847f2200c1d7987`: [CI run 40878971790](https://github.com/AligasSRM/Alex-Studio/actions/runs/40878971790) and [Docker Integration run 40878972379](https://github.com/AligasSRM/Alex-Studio/actions/runs/40878972379). Phase 3 acceptance gates are satisfied within the documented scope. Docker daemon, host kernel, pinned image, and trusted cache remain trusted components; this is not a claim of complete host/kernel isolation.


## Post-Phase 3 hardening follow-up — approved runner image allowlist

**Finding (read-only audit, 2026-10-29):** the original image validator accepted any Microsoft Playwright tag with any syntactically valid SHA-256 digest. A digest pins an artifact but does not, by itself, establish that the artifact has been reviewed and approved. The manual Docker workflow input had the same overly broad validation.

**Change proposed in PR:** restrict the runner and manual workflow input to the single currently reviewed image `mcr.microsoft.com/playwright:v1.56.1-noble@sha256:42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2`. Unit tests must reject a different digest and a different tag even when both are syntactically valid. This is a hardening follow-up; it does not reopen the already closed Phase 3 acceptance gate or imply that the image is independently certified beyond the recorded review.

**Acceptance evidence required:** unit CI and real-Docker integration must pass on the exact PR head. The merge decision remains separate and requires explicit project-owner approval.
