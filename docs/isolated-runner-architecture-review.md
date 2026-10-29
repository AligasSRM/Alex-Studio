# Isolated Generated-Project Runner — Architecture and Threat-Model Review

- Repository: `AligasSRM/Alex-Studio`
- Stage: **DESIGN REVIEW — NO IMPLEMENTATION**
- Date: 2026-10-28
- Related specification: PR #18, `docs/isolated-generated-project-runner.md` (verify path on the specification branch before implementation)
- Audited baseline: `main` at review time
- Decision requested: approve the bounded architecture and resolve the explicit blockers below before code changes.

## Executive decision

Do not extend the current browser smoke-test function in-place to execute project scripts. Keep browser smoke testing as a distinct check and add a separately bounded Node/npm verification runner. The runner must fail closed if the host cannot prove the required image, network, filesystem, resource, timeout, or cleanup controls are available.

This review is based on repository source inspection, not a live Docker penetration test. It does not certify the current host's Docker daemon, storage driver, kernel controls, or image provenance.

## Baseline findings

Audited `app/api/ai/iterate/route.ts`:

1. The current `runSandbox` executes a fixed Playwright browser script against `/workspace/index.html`; it does not run the generated project's declared build/test/lint/typecheck scripts.
2. The image is configured as the mutable tag `mcr.microsoft.com/playwright:v1.56.1-noble`, not a digest-pinned reference.
3. Docker is started with `--network none`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`, non-root UID, memory/CPU/PID limits, and a read-only workspace bind mount. These are valuable existing controls and should be preserved or strengthened.
4. A timeout kills the Docker CLI child process. The code does not explicitly address a container ID, verify container termination, or independently verify cleanup after timeout.
5. No explicit disk quota is configured for the host temporary workspace. A capped `/tmp` tmpfs inside the container is not a quota for the host-side workspace.
6. Host `node_modules` is mounted read-only and exposed through `NODE_PATH`. This is the browser harness's dependency source; it is not a documented dependency-resolution policy for arbitrary generated projects.
7. Output is bounded to the last 12,000 characters, but truncation is not represented as structured evidence. The result type (`ok`, `available`) also cannot express all required statuses (`PASS`, `FAIL`, `NOT RUN`, `UNAVAILABLE`).
8. Temporary workspace cleanup is in a `finally` block, but container/process cleanup is not separately proven. File content is copied to a new temporary tree, which reduces direct exposure to original project files; this is not a substitute for explicit resource and path policies.

## Proposed minimal architecture

### A. Keep the orchestration boundary small

Separate the existing endpoint into orchestration and independently testable modules:

- **Preflight:** validate the draft and project metadata, canonical paths, duplicate paths, file count, per-file and total byte caps; parse `package.json` as data only; inspect lockfile format and consistency without executing project code.
- **Check planner:** map only allow-listed script names (`build`, `test`, `lint`, `typecheck`) to invocations. Never accept shell fragments, arbitrary executable paths, or command strings from the request. Missing scripts become `NOT RUN`.
- **Dependency policy:** first version supports npm only and requires a supported lockfile. Do not silently rewrite the lockfile. Do not execute dependency lifecycle scripts by default. Use only a pre-approved offline artifact/cache whose provenance and compatibility can be verified. If that source is unavailable, report `UNAVAILABLE`; do not enable network access as a fallback.
- **Isolated command runner:** run each applicable command in a disposable container with a digest-pinned approved image, network disabled, non-root UID, read-only base filesystem, dropped capabilities, `no-new-privileges`, no secrets, no Docker socket, no host home/config mounts, and explicit CPU/memory/PID/wall-clock/output/storage limits.
- **Browser smoke test:** preserve as a distinct check with its own evidence and status. It must not stand in for build/test evidence.
- **Evidence aggregator:** produce one record per check and a conservative aggregate result. Natural-language acceptance requirements remain separately `UNVERIFIED` unless mapped to deterministic assertions or reviewed manual evidence.
- **Cleanup supervisor:** own the container ID and disposable workspace lifecycle. On timeout, cancellation, error, and normal completion, request container termination, wait for termination, force-remove if needed, and verify cleanup. Cleanup failure must be visible and must prevent PASS.

### B. Source and writable workspace model

- Never mount the user's actual project directory writable.
- Materialize a validated snapshot into a dedicated disposable workspace; reject symlinks, traversal, non-canonical paths, protected paths, duplicate paths, and oversized content.
- Keep the source snapshot read-only to the runner where feasible. Put build outputs and scratch data only in disposable writable storage.
- Require an enforceable storage bound for the entire writable workspace, not just a tmp directory. Prefer an explicitly bounded tmpfs or a verified filesystem/project quota supported by the deployment. Docker storage-driver options must not be assumed portable.
- If the deployment cannot prove the storage limit is enforced, return `UNAVAILABLE` before executing generated code.

### C. Image pinning

- Do not invent or manually guess a digest.
- Select an approved Playwright/Node image through a controlled maintenance step, resolve its immutable registry digest, record the source and verification date, and pin the exact `repository@sha256:...` reference.
- If the configured image is not digest-pinned or cannot be pulled/verified under the policy, fail closed with `UNAVAILABLE`.
- Image updates require a deliberate reviewed change and CI coverage.

### D. Dependency provenance

- The generated project's own dependencies must not be satisfied implicitly by the server's host `node_modules`.
- Require a supported npm lockfile and deterministic package-manager/runtime versions.
- Prepare dependencies only from an approved offline cache/artifact source inside the disposable boundary. No live network access from install scripts or project scripts.
- Disable lifecycle scripts by default. If a supported project demonstrably needs a lifecycle script, treat that as a separate explicit policy decision with a reviewed threat analysis; do not silently enable it.
- If required dependencies are absent from the trusted offline source, return `UNAVAILABLE`, not a partial pass.

## Threat model

### Assets to protect

- Host filesystem, source projects and other users' project data.
- API keys, environment secrets, credentials, home/config files, Docker socket and daemon control.
- Host availability, disk, memory, CPU, process table and service responsiveness.
- Integrity of the original project, lockfiles, repair drafts and verification evidence.
- Correctness of status shown to the user.

### Adversary and trust assumptions

Treat generated source, package manifests, test/build scripts, dependency contents, output, filenames and repair drafts as untrusted. They may intentionally attempt host-file access, network access, resource exhaustion, path escapes, misleading output, or process persistence. The API process and approved runner image are trusted only to the extent supported by deployment configuration and review. Container isolation is defense-in-depth, not a claim that arbitrary hostile code is perfectly safe.

### Required controls and failure behavior

| Threat | Required control | Failure behavior |
|---|---|---|
| Mutable/compromised image | Approved digest-pinned image and provenance record | `UNAVAILABLE` |
| Network exfiltration or remote code fetch | Runtime-enforced `--network none`; no network-enabled fallback | Policy violation or infrastructure failure; never PASS |
| Host secret/file access | No secret/env propagation, no home/config mounts, no Docker socket, minimal mounts, non-root, dropped capabilities | Deny access; redact diagnostics; fail check if policy violated |
| Host project mutation | Disposable copy; no writable bind of real project | Reject/FAIL; verify original hashes unchanged |
| Path traversal/symlink escape | Canonical relative paths, duplicate/path/protected-file checks, no symlink escape | Reject before execution |
| Disk exhaustion | Enforced quota for all writable workspace/storage; input/output caps | Stop execution; FAIL; cleanup |
| CPU/memory/process exhaustion | CPU, memory, PID and wall-clock limits | FAIL; terminate entire container/process tree |
| Child process survives timeout | Track container ID; stop/kill/wait/remove; verify absence | FAIL and surface cleanup failure |
| Dependency supply-chain execution | Lockfile validation, offline trusted artifacts, lifecycle scripts disabled by default | `UNAVAILABLE` if policy cannot be satisfied |
| Log-based secret leakage or unbounded output | Bounded stdout/stderr, structured truncation marker, redaction | Truncate/redact; evidence must show truncation |
| False success from skipped checks | Explicit per-check status and conservative aggregation | Aggregate cannot PASS if required check is not PASS |
| Requirement overclaim | Requirement-to-assertion mapping separate from command results | Unmapped requirements stay `UNVERIFIED` |

## Status and evidence contract

Each check must have exactly one status:

- `PASS`: the check actually executed and completed successfully under all required controls.
- `FAIL`: a command failed, timed out, exhausted a resource limit, violated policy, or cleanup could not be proven.
- `NOT RUN`: an applicable script is absent or a check was deliberately not scheduled; include a reason.
- `UNAVAILABLE`: the required infrastructure, approved image, trusted dependency artifact, or enforceable control is unavailable.

Aggregate status is `PASS` only if all applicable required commands and the browser smoke test are `PASS`. Any `FAIL` makes the aggregate `FAIL`. Any required `NOT RUN` or `UNAVAILABLE` prevents aggregate PASS and remains visible. Do not map `NOT RUN` or `UNAVAILABLE` to `PASS`.

Record per check: script name and resolved argv, working directory, runtime/npm versions, lockfile digest, image digest, start/end time, exit code or termination reason, bounded stdout/stderr, output-truncated flag, resource-limit/timeout events, and cleanup result. Redact secrets before persistence or response.

## Implementation sequence and gates

1. **Design review:** accept or amend this architecture and threat model; decide approved image/digest maintenance and offline dependency source.
2. **Small runner interface:** implement preflight, explicit check statuses, command allow-list, evidence schema and aggregate status with unit tests only.
3. **Container supervisor:** implement digest enforcement, storage quota capability check, container ID tracking, whole-container timeout/cleanup and fail-closed behavior.
4. **Dependency preparation:** implement only the reviewed offline npm policy; no live-network fallback and no implicit host `node_modules`.
5. **Integration tests:** cover all 16 RUN cases in the specification, with explicit tests for image digest validation, cleanup, storage exhaustion, child-process termination, host-file isolation, lockfile immutability and log redaction.
6. **UI/API evidence:** expose each check and its status separately; preserve `UNVERIFIED` requirement-level results.
7. **Verification:** run repository CI plus Docker integration tests on the supported deployment environment. CI without Docker boundary tests is insufficient.
8. **Separate implementation PR:** open only after design decisions are approved; do not modify or merge the specification-only PR as if it contained implementation.

## Blocking decisions before implementation

- [ ] Approve the exact image repository and immutable digest, with a documented update process.
- [ ] Identify the supported deployment storage mechanism and demonstrate an enforceable writable-workspace quota.
- [ ] Choose and provision the trusted offline npm artifact/cache source; define its provenance and retention.
- [ ] Decide whether any dependency lifecycle scripts may ever be enabled; default is disabled.
- [ ] Confirm the supported Docker/runtime environment can terminate and verify removal of timed-out containers.
- [ ] Approve the evidence schema and status aggregation rules.

**Recommendation:** approve this architecture direction in principle, but do not start implementation until the image, storage quota, dependency provenance, and container-cleanup blockers above have concrete deployment-specific answers.
