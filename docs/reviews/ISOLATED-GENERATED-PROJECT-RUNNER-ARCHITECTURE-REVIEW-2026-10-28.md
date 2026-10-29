# Isolated Generated-Project Runner — Architecture and Threat-Model Review

- Repository: `AligasSRM/Alex-Studio`
- Stage: **DESIGN REVIEW ONLY — OPEN**
- Base: `main` at `6236a27069d507de55d8555a4c9e866415fdcd0a`
- Related specification: `docs/specs/ISOLATED-GENERATED-PROJECT-RUNNER-ACCEPTANCE-2026-10-28.md` on PR #18
- Implementation status: **NO APPLICATION CODE CHANGES**
- Purpose: resolve architecture and security blockers before a separate implementation PR is authorized.

## 1. Recommendation

Use a two-phase, fail-closed pipeline: (A) validate project metadata and prepare dependencies in a disposable, network-disabled environment; (B) execute allowlisted project scripts in a separate disposable sandbox. Preserve the existing browser smoke test as a separate result. Do not mount the host's `node_modules` into generated-code execution and do not run generated scripts on the host.

The first release supports Node.js/npm only. Any environment that cannot satisfy the controls below returns `UNAVAILABLE`; it must not downgrade isolation to make a run succeed.

## 2. Proposed flow

1. **Static preflight (host-side, no generated code execution):** parse `package.json` as data; enforce canonical paths, size limits, supported Node/npm declarations, script-name allowlist (`build`, `test`, `lint`, `typecheck`), and one supported npm lockfile. Never accept arbitrary command strings from the request.
2. **Immutable input snapshot:** copy the draft into a newly created disposable workspace using validated regular files. Reject symlinks, traversal, duplicate paths, protected paths, and unexpected file types. Record a digest of the input snapshot and lockfile. Never mount the actual project writable.
3. **Dependency preparation:** use a digest-pinned, approved builder image and a pre-approved, integrity-checked offline npm cache/artifact source. Disable network at the runtime layer. Run dependency preparation in a separate disposable environment with lifecycle scripts disabled by default. If dependencies cannot be prepared safely or require unsupported install-time execution, return `UNAVAILABLE`; do not fall back to live network access or host `node_modules`.
4. **Execution sandbox:** mount only the disposable workspace and narrowly scoped scratch/output storage. Use a digest-pinned runtime image, non-root UID, read-only root filesystem, no network, dropped capabilities, `no-new-privileges`, no host home/config/secrets, no Docker socket, and a minimal explicit environment. Run only selected scripts by fixed npm argument construction; do not pass user-controlled shell fragments.
5. **Resource and process controls:** enforce CPU, memory, PID, workspace/scratch disk, output-byte, per-command wall-clock, and total-run limits. On timeout or policy violation, terminate the container through the container runtime, wait for termination, and remove it; do not rely solely on killing the Docker client process.
6. **Independent browser check:** keep the current browser smoke test as a separate result and retain its own timeout and cleanup evidence. A browser pass cannot mask a build/test failure.
7. **Evidence and cleanup:** return per-command status, invocation, workdir, runtime/npm versions, image digest, lockfile/input digests, timestamps, exit/termination reason, bounded redacted stdout/stderr, and explicit truncation indicators. Remove containers, temporary workspaces, and scratch data on every terminal path. Persist only the bounded evidence needed for the UI.

## 3. Threat model

| Threat | Required mitigation | Fail-closed behavior |
|---|---|---|
| Generated script attempts network access | Runtime-enforced network namespace/policy with no network | Mark command FAIL if policy violation is observed; never enable network |
| Script reads host secrets/configuration | No host home/config/secret mounts; minimal environment; isolated filesystem | Stop run and return FAIL/UNAVAILABLE with redacted evidence |
| Script modifies user project | Execute only against disposable snapshot | Verify original project remains unchanged |
| Path traversal or symlink escape | Canonical path validation; reject symlinks and non-regular inputs | Reject before execution |
| Malicious dependency lifecycle script | Offline approved cache; lifecycle scripts disabled during preparation | UNAVAILABLE if required dependency cannot be safely prepared |
| Resource exhaustion or fork bomb | CPU, memory, PID, disk, output, wall-clock limits; runtime-level termination | FAIL with termination reason; confirm cleanup |
| Mutable or compromised image | Pin image by immutable digest and review update process | UNAVAILABLE if the approved digest is unavailable |
| Stale or misleading evidence | Hash inputs and lockfile; record image/runtime; distinct statuses per check | No aggregate PASS when required evidence is missing |
| Container/runtime infrastructure failure | Explicit runtime health/error mapping and cleanup verification | UNAVAILABLE; never treat as a project pass |

## 4. Concrete baseline gaps to resolve

- Current `IMAGE` uses a version tag, not an immutable digest.
- Current timeout kills the Docker client process; container/process-tree termination and cleanup are not explicitly verified.
- Current invocation has CPU, memory, and PID limits but no explicit workspace/disk quota.
- Current implementation mounts host `node_modules` read-only. This is not an acceptable dependency-provenance strategy for executing arbitrary generated scripts.
- Current browser-only runner does not execute the generated project's own declared build/test/lint/typecheck commands.
- Existing Docker availability/image-pull detection is text-pattern-based; status mapping should be explicit and tested.
- Output is bounded by retaining the last 12,000 characters, but the evidence does not explicitly indicate truncation and does not separate stdout from stderr.

## 5. Decisions required before implementation

1. **Approved image:** select and record the exact image digest and a documented update/verification policy.
2. **Offline dependencies:** define how the approved npm cache/artifacts are built, reviewed, integrity-checked, and supplied to the isolated preparation stage. No implicit network fallback.
3. **Install lifecycle scripts:** default to disabled; define the precise `UNAVAILABLE` behavior when a dependency requires an install script. Do not silently relax this control.
4. **Writable workspace and disk cap:** choose a runtime-supported disposable writable area with an enforceable quota. If the deployment environment cannot enforce the quota, report `UNAVAILABLE`.
5. **Termination and cleanup:** specify the container identifier/lifecycle and verify runtime-level stop/kill plus removal after timeout, cancellation, crash, and success.
6. **Required scripts:** specify whether each of `build`, `test`, `lint`, and `typecheck` is required by project profile. Missing required scripts must remain `NOT RUN` and prevent aggregate PASS.
7. **Evidence contract:** define typed result fields and redaction/truncation behavior before connecting results to the UI.

## 6. Status semantics

- `PASS`: every applicable required check actually ran and exited successfully under the required controls.
- `FAIL`: a command failed, timed out, exhausted a resource limit, or violated policy.
- `NOT RUN`: an expected check was not invoked, including a missing required script.
- `UNAVAILABLE`: the runner cannot establish the required safe execution environment or dependencies.
- Aggregate PASS requires all applicable required checks and the configured browser smoke test to PASS. Requirement-level acceptance remains `UNVERIFIED` unless mapped to deterministic assertions or reviewed manual evidence.

## 7. Acceptance gate for this design review

- [ ] The exact image digest and update policy are chosen.
- [ ] Offline dependency preparation and lifecycle-script policy are explicit.
- [ ] Writable workspace/disk quota and runtime-level termination/cleanup are demonstrably enforceable.
- [ ] The evidence schema, required-script profile, and status mapping are agreed.
- [ ] The implementation plan does not run generated code on the host and does not require network access from generated code.
- [ ] This review is accepted before a separate implementation PR is opened.

**Current status: DESIGN REVIEW OPEN. No application code changes are included or authorized by this document.**
