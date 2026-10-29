# Phase 3 Security and Execution Runner Audit — 2026-10-29

**Repository:** `AligasSRM/Alex-Studio`  
**Audit branch:** `phase/3-runner-audit-hardening-2026-10-29`  
**Baseline:** `main` at `1067ecad31b579b5bbc7aae06b9259e43426ed4d`  
**Scope:** The Phase 3 checklist previously discussed: isolated execution of generated projects, dependency installation, evidence reporting, isolation/resource controls, and post-change CI/Docker proof.  
**Disposition:** Audit recorded; implementation evidence is mixed. This report deliberately does not declare the whole phase passed.

## Checklist and evidence

| Checklist item | Repository evidence | Audit status | Required disposition |
|---|---|---|---|
| Define scope and acceptance evidence | This audit lists the checks and the evidence needed. | PASS (documentation) | Keep this matrix as the phase gate. |
| Run generated-project commands in an isolated environment | `lib/ai-command-runner.ts` invokes a pinned Playwright Docker image; `--network none`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`, unprivileged UID, memory/CPU/PID limits, tmpfs workspace. | IMPLEMENTED; runtime proof required | Require Docker integration on the exact candidate commit. |
| Dependency installation safety | Requires `package-lock.json`; accepts npm lockfile v2/v3; installs with `npm ci --offline --ignore-scripts`; no dependency download is intended. | IMPLEMENTED; cache trust remains a precondition | Only use a pre-populated trusted cache; do not mount secrets or use an untrusted cache. |
| Record command results | Runner records command status, timestamps, exit code, bounded output, truncation, runtime, package manager, and lockfile hash. | IMPLEMENTED | Keep missing scripts as NOT RUN/FAIL and missing runtime/cache/image as UNAVAILABLE; never infer success from a browser smoke test. |
| Isolation and resource limits | Docker invocation constrains network, filesystem, capabilities, privilege escalation, memory, CPU, PID count, and execution time; source and cache mounts are read-only. | IMPLEMENTED in code; not a complete host-security certification | Docker daemon and host kernel remain trusted components. Do not claim protection from host/kernel compromise or all resource-exhaustion modes. |
| Prevent secrets entering the runner | The Docker process receives a restricted environment and the script runs with a constructed allowlist environment. | IMPLEMENTED by code inspection | Integration test should explicitly prove a host-only sentinel variable is absent inside a generated command. |
| Prove no project changes leak back to the host | Source is staged and mounted read-only; commands run on a copy under container tmpfs. | IMPLEMENTED by code inspection | Integration test should attempt a write and verify the original host file remains byte-identical. |
| Verify cleanup after execution and timeout | Docker tests check container cleanup after success and timeout; runner uses `--rm` and requests forced removal at wall-clock timeout. | PARTIAL | Run the real Docker tests on the candidate commit; inspect logs if cleanup test fails. |
| CI on the same revision | Main CI runs unit tests, type check, lint, production build, browser acceptance and archive validation; a separate workflow exercises real Docker. | PARTIAL until candidate PR runs complete | Both workflows must pass on the same PR head SHA. |
| Validate actual execution versus static/browser checks | Existing acceptance-gate documentation states static preflight and browser smoke tests do not prove generated-project build/test correctness. | PASS (limitation documented) | Preserve separate statuses; do not mark unexecuted project scripts as PASS. |

## Concrete findings

1. **The isolated runner is present, not hypothetical.** Its implementation applies network isolation, read-only root filesystem, dropped Linux capabilities, non-root UID, no-new-privileges, and bounded memory/CPU/PIDs. Dependency install is offline and lifecycle scripts are disabled.
2. **The repository has real Docker integration tests** for a successful command run, denied network access via DNS lookup, timeout handling, and container cleanup. These tests are opt-in locally and run through `.github/workflows/docker-integration.yml`.
3. **The principal evidence gap is proof coverage, not absence of the runner.** Existing integration tests do not explicitly assert that a host-only sentinel environment variable is absent inside the container, or that a generated command cannot mutate the original host project file. These should be added as regression tests before claiming every Phase 3 item is verified.
4. **A passing CI job is not a host-isolation certification.** Docker daemon access, the host kernel, and the trusted runner image/cache remain part of the trusted computing base. This design is not a substitute for a separate hardened VM for hostile multi-tenant workloads.
5. **No OpenAI-specific provider tests are part of this audit.** The project-owner decision in `PHASE-2-PROVIDER-DECISION-ADDENDUM-2026-10-29.md` remains in force; Groq is the accepted provider for Phase 2.

## Acceptance gate to close Phase 3

- [ ] Unit tests pass on the exact candidate commit.
- [ ] Type check, lint, production build, and browser acceptance pass on the exact candidate commit.
- [ ] Real Docker integration passes on the same candidate commit.
- [ ] Add and pass regression tests for host-only environment isolation and byte-identical host project files after attempted writes.
- [ ] Confirm success, failure, timeout, unavailable runtime/cache, and missing-script outcomes are distinct and evidenced.
- [ ] Review Docker logs and confirm no runner container remains after normal completion and timeout.
- [ ] Keep the documented trusted-computing-base limitation; do not claim full host/kernel isolation.

**Current decision:** Do not close Phase 3 solely on code inspection. The next code change should add the two missing regression tests above; then rerun both CI workflows and record their run URLs and exact head SHA here.
