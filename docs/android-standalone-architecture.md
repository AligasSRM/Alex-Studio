# Android Standalone Architecture

## Status

- Decision: approved to use a private, authenticated cloud backend for AI and project execution.
- Scope: make the Android app usable without a paired computer.
- Project files: remain on the device as the canonical copy.
- Provider/deployment: not selected or provisioned yet.
- Release: no public deployment and no merge to `main` as part of this design step.

## Current constraint

The existing Android companion is a WebView that targets a localhost server. The current Studio server owns project persistence through Node.js filesystem APIs and runs build/preview work through Docker. That topology cannot run unchanged on a standalone Android device.

## Target topology

```text
Android app
  ├─ Local project workspace (canonical files, history, offline edits)
  ├─ Editor / preview UI
  └─ HTTPS API client
        │
        ▼
Private Alex Studio API
  ├─ Authentication and per-user authorization
  ├─ Groq gateway (server-side secret only)
  ├─ Temporary job staging (explicit file selection / task snapshot)
  ├─ Isolated build and test workers
  └─ Minimal account / job metadata
        │
        └── Groq API (server-to-server)
```

## Data ownership and privacy

1. The phone is the source of truth for project files and local editor history.
2. The backend stores account/device credentials, job metadata, and operational audit events; it does not become the default permanent project-file store.
3. For AI or build tasks, the app sends only the selected files and context needed for that task over TLS.
4. Uploaded task snapshots are temporary, scoped to one job, and deleted after completion or a short bounded retention window. Retention and deletion behavior must be tested and documented.
5. Secrets such as the Groq API key exist only in the backend secret manager/runtime environment. They must never be shipped in the APK, source maps, client configuration, or logs.
6. Users must be able to cancel jobs and delete temporary task data.

## Security requirements

- HTTPS only; reject cleartext API traffic in Android release builds.
- Short-lived access tokens and rotating refresh credentials; store device credentials using Android Keystore-backed secure storage.
- Enforce user ownership on every project/job API operation; never trust a client-supplied user or tenant identifier.
- Rate-limit authentication, AI, and job endpoints; apply request-size and per-user resource quotas.
- Treat every uploaded project as untrusted input.
- Execute builds/tests in disposable, isolated workers with CPU, memory, disk, process, and wall-clock limits.
- Disable worker network egress by default; allow only explicitly required package access through controlled mirrors/proxies.
- Do not mount backend credentials or host filesystem paths into job workers.
- Redact secrets and project contents from application logs; maintain minimal audit events.
- Define backup, deletion, incident response, and service availability policies before production use.

## Execution model

The existing Docker-based command runner is a useful reference, not a drop-in Android runtime. The cloud worker must expose a narrow job API (submit, inspect status, cancel, fetch result). Workers should use disposable sandboxes and never accept arbitrary privileged host commands. The first supported build/test matrix should be explicitly limited to runtimes that can be safely provisioned and verified.

## API boundary (initial contract)

- `POST /v1/jobs`: create a job with an explicit task type and selected file snapshot.
- `GET /v1/jobs/{jobId}`: read status and bounded result metadata.
- `POST /v1/jobs/{jobId}/cancel`: cancel a running job.
- `GET /v1/jobs/{jobId}/artifacts/{artifactId}`: retrieve a validated output artifact.
- `POST /v1/ai/generate`: server-side Groq request using scoped input and user quota.
- All endpoints require authenticated ownership checks, schema validation, size limits, and idempotency where applicable.

The exact schemas and compatibility layer must be derived from the current Studio API routes before implementation.

## Delivery sequence

1. Inventory current API routes, authentication, project storage, undo/history, Docker runner, preview, and Android bridge.
2. Define a versioned API contract and threat model; decide the cloud host and operational ownership before provisioning.
3. Implement the backend gateway and isolated worker adapter behind feature flags; preserve existing desktop/local behavior.
4. Implement Android local project storage, history, sync/task staging, secure credentials, and offline behavior.
5. Add integration tests for authorization boundaries, temporary-data deletion, job isolation, cancellation, quotas, and failure recovery.
6. Build the APK, test on a physical Samsung device without a computer attached, and verify the complete create/edit/AI/build/preview workflow.
7. Review CI and security findings; only then prepare a release decision.

## Acceptance criteria

- App opens and creates/edits/saves projects with no computer connection.
- Local files remain available offline and survive app restart.
- Groq-backed actions work through the authenticated backend with no client-side Groq secret.
- Build/test jobs run in isolated cloud workers and return bounded results.
- Unauthorized users cannot read, run, or cancel another user's jobs.
- Temporary uploaded task data is deleted according to the documented policy.
- Physical-device testing confirms the end-to-end workflow over mobile data and Wi-Fi.
- Existing desktop workflows and security controls remain intact.
