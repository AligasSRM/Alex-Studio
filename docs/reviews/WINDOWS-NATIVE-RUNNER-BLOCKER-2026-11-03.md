# Windows-native generated-code execution — blocker and acceptance gate

**Status:** BLOCKED / NOT IMPLEMENTED  
**Scope:** Windows 10 host + Android companion only. Linux, WSL2, Docker-as-Linux, and unrestricted host execution are prohibited.

## Current safety behavior

The generated npm command runner has been changed to fail closed. For npm projects it reports `UNAVAILABLE` and does not start generated commands until a Windows-native isolation provider is implemented. A static project result only means npm checks do not apply; it does not certify browser execution or end-to-end acceptance.

## Why the old runner was removed

The previous runner executed generated code in a Linux Playwright Docker image and required a Docker daemon. That contradicted the locked platform decision and did not establish a Windows 10 execution environment. Running generated npm scripts directly as the Windows user would remove the isolation boundary and is not an acceptable fallback.

## Required implementation before this blocker can close

- Select and threat-model a Windows-native isolation mechanism supported on the target Windows 10 editions/builds.
- Verify it can run untrusted project commands with restricted filesystem/network access, bounded CPU/memory/processes, and reliable timeout termination.
- Bind staging and result collection to a fixed, validated workspace; reject symlinks, junctions, reparse points, and path escapes.
- Prove cleanup and process-tree termination after normal exit, timeout, crash, and host interruption.
- Verify offline dependency installation policy and consistently disable lifecycle scripts.
- Add Windows 10 host acceptance evidence and Android physical-device end-to-end evidence.
- Replace all Linux/Docker runners, scripts, tests, and documentation references only when a verified Windows-native alternative exists.

No build or tests were run as part of this change. The runner remains unavailable for npm projects; this is a safety stop, not completion or platform acceptance.
