# Alex Studio — Locked Platform Scope

- **Decision status:** Permanently locked by the project owner
- **Decision date:** 2026-11-02
- **Scope:** Platform scope only; this record does not certify compatibility or implementation.

## 1. The only approved platforms

Alex Studio is limited to exactly these two platforms:

1. **Windows 10** — the sole computer host for the Alex Studio server, project-file management, backups, execution, testing, and verification.
2. **Android** — the companion/control application used to connect to the Windows 10 host, submit ideas or specifications, review plans and diffs, and provide explicit approvals.

No other operating system or device platform is in scope. This decision is locked and must not be broadened or replaced without a new explicit decision from the project owner.

## 2. Windows 10 implementation requirement

- Windows 10 is the only computer operating-system target.
- All file-management behavior must use Windows-compatible APIs, path handling, permissions, locking, atomic replacement, and recovery semantics.
- Runtime assumptions tied to other operating systems must be removed from application code, scripts, workflows, tests, setup instructions, and project documentation.
- The application must not depend on an alternate operating-system layer or external runtime to provide its core file-management or execution behavior.
- Windows 10 version/build and required security prerequisites must be detected and reported accurately. Compatibility must not be claimed until verified on the target machine.
- If safe isolation or a required security prerequisite is unavailable or cannot be verified, execution and verification must fail closed as `UNAVAILABLE`; generated code must never fall back to unrestricted host execution.

## 3. Android role and safety boundary

- Android is the companion/control client; it is not the trusted execution host for generated project code.
- The Windows 10 host remains responsible for project storage, backups, execution, testing, and evidence collection.
- No project changes may be applied without explicit user approval bound to the exact reviewed plan and file contents.
- Pairing, authentication, transport security, supported Android versions, and minimum device requirements must be validated before implementation is considered accepted.
- This decision does not authorize public hosting, internet exposure, or a cloud relay.

## 4. Required acceptance evidence

Before claiming platform support, record separate evidence for:

- Windows 10 version/build and hardware prerequisite checks.
- Android installation and physical-device control-flow testing.
- Server startup, secure pairing/connection, interruption recovery, and session revocation.
- Windows-native file integrity, path traversal and reparse-point/symlink defenses, locking, atomic replacement, and rollback behavior.
- Isolation runtime availability, timeout handling, process termination, cleanup, and fail-closed behavior.
- The complete generated-project workflow and its actual test results.

Each check must retain its real status (`PASS`, `FAIL`, `NOT RUN`, `UNAVAILABLE`, or `UNVERIFIED`). CI success alone is not proof of end-to-end platform acceptance.

## 5. Change control

This is the canonical record of the approved platform scope. The approved scope is **Windows 10 + Android only**. Do not re-open the platform decision or add other platform targets without a new explicit decision from the project owner.

**Important:** This document records the locked scope. It does not claim that Windows 10 or Android compatibility has been implemented, physically tested, or accepted for release.
