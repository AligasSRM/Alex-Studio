# Windows-native generated-code execution — blocker and acceptance gate

**Status:** BLOCKED / NOT IMPLEMENTED  
**Scope:** Windows 10 host + Android companion only. Generated code must not execute directly on the host.

## Current safety behavior

The generated npm command runner, browser verification, build/server preview, and file write/delete operations fail closed. They report `UNAVAILABLE` until Windows-native isolation and handle-based file mutation protections are implemented. Read-only file access remains available subject to path checks. A static project result only means npm command checks do not apply; it does not certify browser execution or end-to-end acceptance.

## Why the former runner was removed

The former runner depended on an alternate-OS container runtime and did not establish execution on the approved Windows 10 host. Running generated npm scripts directly as the Windows user would remove the isolation boundary and is not an acceptable fallback.

## Required implementation before this blocker can close

- Select and threat-model a Windows-native isolation mechanism supported on the target Windows 10 editions/builds.
- Implement handle-based Windows file mutation with verified reparse-point protection, atomic replacement, backup/rollback semantics, and concurrency control.
- Verify it can run untrusted project commands with restricted filesystem/network access, bounded CPU/memory/processes, and reliable timeout termination.
- Bind staging and result collection to a fixed, validated workspace; reject symlinks, junctions, reparse points, and path escapes.
- Prove cleanup and process-tree termination after normal exit, timeout, crash, and host interruption.
- Verify offline dependency installation policy and consistently disable lifecycle scripts.
- Add Windows 10 host acceptance evidence and Android physical-device end-to-end evidence.
- Remove all remaining non-Windows runtime assumptions from scripts, workflows, tests, and documentation as the verified Windows-native alternative is implemented.

No build or tests were run as part of this change. The runner remains unavailable for npm projects; this is a safety stop, not completion or platform acceptance.
