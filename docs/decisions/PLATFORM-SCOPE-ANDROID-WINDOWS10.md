# Alex Studio — Platform Scope Decision

- **Decision status:** Approved by the project owner
- **Decision date:** 2026-11-02
- **Scope:** Platform scope only; this record does not certify compatibility or implementation.

## 1. Approved platforms

Alex Studio is in scope for exactly these two platforms:

1. **Android** — companion/control application for viewing project status, submitting ideas or specifications, reviewing proposed changes, and giving explicit approvals.
2. **Windows 10** — the host platform for the Alex Studio server, project files, backups, and project execution/verification environment.

## 2. Explicit exclusions

The following are outside the approved product scope unless the project owner changes this decision:

- Windows 11
- macOS
- Linux desktop distributions
- Any additional mobile platform, including iOS

Do not describe Alex Studio as supporting Windows 10 and Windows 11. Windows 10 is the only supported Windows target in this decision.

## 3. Windows 10 compatibility boundary

- Windows 10 **22H2** is the initial candidate baseline for compatibility testing.
- Compatibility must be verified on the actual target environment, including the required virtualization/container runtime and its prerequisites.
- A platform being in scope does not mean that every Windows 10 edition, build, hardware configuration, or container setup is supported.
- Windows 10 reached end of general support on 2025-10-14. The application must disclose the host's update/ESU status where it can be reliably detected. ESU enrollment must not be assumed.
- If the required isolation environment is unavailable or cannot be verified, execution and verification must fail closed as `UNAVAILABLE`; do not fall back to executing generated code directly on the host.

## 4. Android role and safety boundary

- Android is the companion/control client; it is not the trusted execution host for generated project code.
- The Windows 10 host remains responsible for project storage, backups, isolated execution, testing, and evidence collection.
- No project changes may be applied without the user's explicit approval bound to the exact reviewed plan and file contents.
- The connection mechanism, pairing protocol, supported Android versions, and minimum device requirements remain separate technical decisions and must be validated before implementation is considered accepted.
- This scope decision does not authorize public hosting, internet exposure, or a cloud relay.

## 5. Acceptance evidence required

Before claiming platform support, record separate evidence for:

- Android installation and physical-device control-flow testing.
- Windows 10 version/build and hardware prerequisite checks.
- Server startup, pairing/connection, interruption recovery, and session revocation.
- Project file integrity and approval-gate behavior.
- Isolation runtime availability, timeout handling, process/container termination, and cleanup.
- The complete generated-project workflow and its actual test results.

Each check must retain its real status (`PASS`, `FAIL`, `NOT RUN`, `UNAVAILABLE`, or `UNVERIFIED`). CI success alone is not proof of end-to-end platform acceptance.

## 6. Change control

This is the canonical record of the approved platform scope. Any expansion or replacement of the two-platform scope requires an explicit decision by the project owner and a separately reviewed documentation change.

**Important:** This document records an approved scope decision. It does not claim that Android or Windows 10 compatibility has been implemented, physically tested, or accepted for release.
