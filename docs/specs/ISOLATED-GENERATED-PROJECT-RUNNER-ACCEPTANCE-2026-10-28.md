# Isolated Generated-Project Runner — Acceptance Specification

- Repository: `AligasSRM/Alex-Studio`
- Stage: **SPECIFICATION ONLY — OPEN**
- Branch: `spec/isolated-generated-project-runner-2026-10-28`
- Scope owner: Alex Studio AI build / verify / repair workflow
- Prerequisite: PR #16 merged; PR #17 documentation correction merged after its PR CI passed.
- Implementation status: **NO RUNNER CODE CHANGES AUTHORIZED BY THIS SPECIFICATION**
- Baseline implementation: `app/api/ai/iterate/route.ts` currently starts a Docker Playwright browser smoke test with no network, a read-only root filesystem and workspace mount, dropped capabilities, non-root UID, memory/CPU/PID limits, and a 20-second timeout. It does not execute the generated project's own build/test/lint/typecheck commands.

## 1. Objective

Extend the existing isolated verification path so it can produce trustworthy, bounded evidence for supported generated projects' declared build and test commands, while preserving the current browser smoke test and never converting missing or incomplete evidence into success.

This is an evidence gate, not a promise that an arbitrary project is correct, secure, production-ready, or fully compliant with a natural-language specification.

## 2. In-scope requirements

1. **Explicit command inventory.** Parse `package.json` as data; identify only known script names from `build`, `test`, `lint`, and `typecheck`. Do not accept arbitrary host commands, executable paths, or shell fragments from an API request.
2. **Supported runtime declaration.** The initial implementation supports Node.js/npm projects only. Unsupported runtimes and package managers must report `UNAVAILABLE`, not PASS.
3. **Lockfile policy.** Require a supported, consistent npm lockfile before dependency installation. Reject ambiguous or malformed lockfile/package metadata. Never silently regenerate or modify the user's lockfile.
4. **Dependency preparation.** Dependencies must be prepared in a disposable isolated environment using a documented safe policy. Prefer a pre-approved offline cache or artifact source. If dependencies cannot be resolved without violating the no-network policy, return `UNAVAILABLE`. Any installation lifecycle-script policy must be explicit and tested; do not run dependency lifecycle scripts by default.
5. **Network isolation.** Generated build/test commands run with outbound and inbound network access disabled. Network denial must be enforced by the container/runtime, not merely by application convention.
6. **Container isolation.** Reuse or strengthen the existing Docker-based isolation. Require non-root execution, read-only root filesystem, read-only source input, dropped Linux capabilities, `no-new-privileges`, no host secrets, no Docker socket mounted into the container, no host home/config mounts, and explicit CPU, memory, PID, disk/workspace-size and wall-clock limits. Any writable scratch or output area must be narrowly scoped and disposable.
7. **Path and file safety.** Validate canonical relative paths and reject traversal, symlinks that escape the workspace, duplicate paths, protected paths, and oversized files before mounting the project. Never allow generated code to write into the actual project directory.
8. **No implicit success.** Each command has exactly one status: `PASS`, `FAIL`, `NOT RUN`, or `UNAVAILABLE`. A missing script is `NOT RUN`; unsupported runtime, missing Docker/image/cache, unavailable dependency resolution, or an infrastructure failure is `UNAVAILABLE`; non-zero exit, timeout, resource exhaustion, or policy violation is `FAIL`. No command that did not execute successfully can be reported as PASS.
9. **Evidence record.** For every command, record the exact script name and resolved invocation, working directory, runtime/package-manager versions, lockfile digest, image identifier/digest when available, start/end timestamps, exit code or termination reason, and bounded stdout/stderr. Redact secrets and cap total output.
10. **Aggregate result.** Overall runner status is `PASS` only if every applicable required command and the configured browser smoke test passed. Any `FAIL` means aggregate `FAIL`; any required `NOT RUN` or `UNAVAILABLE` prevents aggregate PASS and must remain visible.
11. **Specification traceability.** Keep natural-language acceptance requirements separate from command results. Requirements remain `UNVERIFIED` until mapped to deterministic assertions or explicit reviewed manual evidence. Passing generic project scripts alone does not prove every specification requirement.
12. **Repair-loop integrity.** Repairs operate only on disposable draft copies. After every repair round, rerun all applicable required checks from a clean workspace. Do not apply drafts to the user's project as a side effect of verification. Preserve existing explicit approval and stale-draft/hash protections.
13. **Resource and failure handling.** Test timeout, output truncation, process-tree termination, container start failure, image unavailable, dependency unavailable, malformed manifests, disk/size limits, and cleanup after both success and failure. Every terminal path must clean up disposable resources.
14. **Auditability.** The workspace UI and API response must distinguish static preflight, browser smoke test, build/test commands, and requirement-level evidence. Do not label the entire specification accepted based only on an aggregate script pass.

## 3. Out of scope for the first implementation

- Arbitrary programming languages or package managers other than Node.js/npm.
- Network-enabled dependency installation or running builds that require live external services.
- Claims of full semantic equivalence to a natural-language prompt.
- Deployment, production readiness, performance certification, or security certification of generated applications.
- Automatic application of generated changes to the real project.
- Expanding the repair loop beyond its existing bounded number of rounds without a separate decision.

## 4. Required test matrix

| ID | Scenario | Required result |
|---|---|---|
| RUN-01 | Supported npm project, valid lockfile, all required scripts pass | Aggregate PASS with evidence for each executed command |
| RUN-02 | Build or test script exits non-zero | Command FAIL; aggregate FAIL |
| RUN-03 | Required script missing | NOT RUN; aggregate cannot PASS |
| RUN-04 | Unsupported runtime/package manager | UNAVAILABLE; no command execution |
| RUN-05 | Lockfile absent, invalid, or inconsistent | UNAVAILABLE or FAIL with explicit reason; no silent lockfile rewrite |
| RUN-06 | Dependency unavailable under offline policy | UNAVAILABLE; never reported as success |
| RUN-07 | Script attempts network access | Access blocked; violation/failure evidence captured |
| RUN-08 | Script attempts to read host secrets or host files | Access denied; no secret values in logs |
| RUN-09 | Script attempts path traversal or symlink escape | Rejected or contained; host/project files unchanged |
| RUN-10 | Infinite loop / excessive memory / process explosion | Timeout or resource limit enforced; FAIL; child processes terminated |
| RUN-11 | Excessive stdout/stderr | Output bounded; truncation explicitly indicated |
| RUN-12 | Docker daemon/image unavailable | UNAVAILABLE; cleanup verified |
| RUN-13 | Browser smoke test passes but build/test fails | Overall FAIL; separate results preserved |
| RUN-14 | Build/test pass but acceptance requirement has no mapped assertion | Requirement remains UNVERIFIED; no full-spec PASS |
| RUN-15 | Repair round changes files | Clean rerun of all applicable checks; real project remains unchanged |
| RUN-16 | Every execution and cleanup path | Disposable files/containers removed; no persistent writable mount |

## 5. Security review gates

Before implementation is accepted, review:
- Docker invocation construction and command argument boundaries.
- Image pinning and image availability policy.
- Whether any host-level Docker privileges can be reached from generated code.
- Mount list, environment variables, user/group IDs, filesystem permissions and temporary directories.
- Symlink handling and canonical path validation.
- Dependency lifecycle scripts, lockfile integrity and offline artifact provenance.
- Redaction and maximum size of all persisted or returned diagnostics.
- Timeout enforcement for the complete process tree and reliable cleanup.

If the runtime cannot enforce a requirement, the feature must fail closed and report `UNAVAILABLE`; do not weaken the requirement silently.

## 6. Implementation sequence (not started)

1. Audit the existing `runSandbox` function and Docker image/dependency assumptions against this specification.
2. Propose the smallest architecture change and threat model in a separate review before implementation.
3. Implement the runner behind a bounded interface, keeping browser smoke-test behavior separate.
4. Add unit tests for status mapping, command selection, manifest/lockfile validation, evidence redaction and aggregate status.
5. Add isolated integration tests for network/filesystem/resource boundaries and cleanup.
6. Run the repository's full CI and browser acceptance.
7. Review evidence and limitations; only then consider marking the implementation stage complete.

## 7. Acceptance gate

This specification stage can close only when:
- The requirements and test matrix have been reviewed.
- Security review gates are addressed or explicitly documented as blockers.
- The implementation plan does not require network access or host-side execution of generated scripts.
- A separate implementation PR is created after this specification is accepted.
- No source-code implementation is included in the specification-only PR.

**Current status: SPECIFICATION OPEN. No code implementation has started.**
