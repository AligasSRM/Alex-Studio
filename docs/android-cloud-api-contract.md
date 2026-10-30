# Standalone Android Cloud API Contract (Draft)

Status: design draft only; no endpoint is enabled or deployed.

## Principles

- Version all remote endpoints under /v1.
- Require TLS and authenticated access for every endpoint except health/readiness probes.
- Derive user and device identity from the verified access token; never accept a client-provided ownerId as authority.
- Validate all JSON with strict schemas and reject unknown or oversized fields where practical.
- Set explicit idempotency keys for job creation and mutation requests.
- Keep project files on the phone by default. Upload only a user-approved task snapshot.
- Never return provider credentials or raw internal worker details to the client.

## Authentication boundary

The final identity provider is not selected. The app must use an established OIDC/OAuth-compatible provider or a separately reviewed authentication service. Use short-lived access tokens, rotating refresh credentials, revocation, and Android Keystore-backed secure storage. No custom password storage or long-lived static API key in the APK.

## Endpoints

### GET /v1/session

Returns authenticated account/device capabilities and API version. The server derives identity from the bearer token.

### POST /v1/ai/generate

Request fields:
- prompt: non-empty string, bounded to 20,000 characters.
- contextFiles: optional array of explicitly selected { path, content, sha256 } entries with strict per-file and total byte limits.
- idempotencyKey: client-generated unique request key.

The server verifies ownership, user quota, consent/approval, path policy, and context size, then calls Groq using a server-side secret. Response includes generated text and bounded usage metadata. It does not write project files.

### POST /v1/jobs

Creates an asynchronous build/verification job from an explicit task snapshot.

Request fields:
- taskType: allowlisted value such as build, test, or preview.
- projectLabel: optional display-only label; never a filesystem path.
- files: bounded array of { path, content, sha256 } entries.
- commands: optional allowlisted task profile identifier; never arbitrary shell text.
- idempotencyKey: unique request key.

The API enforces per-file, total upload, file-count, and archive-expansion limits; rejects symlinks, special files, traversal paths, protected secret paths, and duplicate normalized paths. It creates a job owned by the authenticated principal and a temporary isolated snapshot.

### GET /v1/jobs/{jobId}

Returns only jobs owned by the authenticated principal. Response contains status, timestamps, bounded logs, summary, and artifact metadata.

### POST /v1/jobs/{jobId}/cancel

Cancels only an owned job. Cancellation is idempotent. The server confirms worker termination and cleanup before marking the job cancelled.

### GET /v1/jobs/{jobId}/artifacts/{artifactId}

Streams a bounded, validated artifact only when the authenticated principal owns the parent job. Use short-lived download authorization and safe content-disposition headers.

### DELETE /v1/jobs/{jobId}

Requests deletion of an owned job and its temporary input/output data, subject to audit metadata retention policy. Return deletion status; do not claim completion until storage and worker cleanup are verified.

## Job state machine

queued -> provisioning -> running -> collecting -> succeeded | failed | cancelled

Any terminal state must have a cleanup outcome. A job must not be reported as succeeded if worker teardown or required artifact validation fails. Cancellation races must be resolved transactionally.

## Temporary data lifecycle

- Task snapshots and artifacts are private, encrypted at rest where supported, and scoped to a single job.
- The app sends selected content only after explicit user action.
- No permanent project workspace is mounted on the worker.
- Worker receives a read-only input snapshot and writes output to a separate bounded directory.
- Retention duration must be configured before production and shown in privacy documentation.
- Deletion must cover worker volumes, temporary object storage, and generated artifacts; retain only minimal non-content audit metadata.

## Error model

Use stable machine-readable codes such as UNAUTHENTICATED, FORBIDDEN, QUOTA_EXCEEDED, INVALID_INPUT, PAYLOAD_TOO_LARGE, JOB_NOT_FOUND, JOB_NOT_CANCELLABLE, PROVIDER_UNAVAILABLE, WORKER_UNAVAILABLE, and RETENTION_EXPIRED. Avoid exposing stack traces, filesystem paths, secrets, or raw provider error bodies.

## Required contract tests

- Anonymous requests are rejected.
- User A cannot inspect, cancel, delete, or download User B jobs.
- Forged owner identifiers have no effect.
- Duplicate idempotency keys do not create duplicate paid jobs.
- Oversized payloads, traversal paths, symlinks, secret files, and malformed hashes are rejected.
- Cancellation kills the worker and verifies cleanup.
- Expired artifacts cannot be downloaded.
- Groq credentials never appear in responses, logs, APK contents, or client bundles.
- AI output is a proposal; local file application requires a separate explicit approval and base-hash check on the phone.
