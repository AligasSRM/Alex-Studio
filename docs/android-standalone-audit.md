# Standalone Android Backend Audit

Audit date: 2026-10-30
Audited baseline: main
Implementation branch: feat/android-standalone-cloud-backend

## Confirmed current behavior

| Area | Current implementation | Standalone implication |
|---|---|---|
| Android client | Separate Android companion proposal uses a WebView and localhost URL via USB ADB reverse | Not standalone; needs a paired host computer |
| Project catalog | lib/project-store.ts reads and writes the server process workspace on disk | Project CRUD must move behind a storage interface; Android local storage becomes canonical |
| File APIs | /api/projects, /api/files, /api/files/read, and /api/files/write call local filesystem-backed stores | These routes cannot be exposed remotely as-is |
| Editor history / Undo | /api/editor-history and lib/editor-history-store.ts persist JSON history under each project .alex/editor-history directory | History should be local-first on Android; cloud history is not required initially |
| Groq | /api/ai/generate reads GROQ_API_KEY server-side and calls Groq Responses API | Provider integration can be reused behind authenticated cloud gateway; current guard blocks remote clients |
| AI iterate / repair | /api/ai/iterate reads project files from server disk, stages them in a host temp directory, and invokes verification/build helpers | Must accept a bounded, explicit task snapshot from authenticated phone; never infer arbitrary server paths from client input |
| Build and preview | lib/ai-command-runner.ts and lib/ai-build-server-preview.ts use pinned Playwright Docker image and host Docker | Reuse safety model, not host-specific implementation; create disposable cloud workers with resource limits and cleanup |
| Rate limiting | lib/rate-limit.ts stores buckets in a process-local Map | Replace with shared/distributed quotas for multi-instance cloud deployment |
| Request guards | API routes use assertLocalRequest / assertLocalMutation from lib/path-security.ts | Add separate authenticated cloud API boundary; do not weaken existing localhost checks |
| AI apply / rollback | Existing endpoints require explicit approval and use batch manifests, hashes, audit records, and rollback checks | Preserve approval and conflict-detection semantics in local Android workspace adapter |

## Groq route details

The existing generation route requires approved: true, limits prompt length to 20,000 characters and body size to 24 KiB, reads GROQ_API_KEY only in the server environment, defaults the Groq model to openai/gpt-oss-20b unless GROQ_MODEL is set, calls https://api.groq.com/openai/v1/responses, uses a 20-second timeout, and records usage before returning the result.

Important gap: the current limiter key is based on request host and is process-local; it is not a per-account cloud quota. The route is intentionally protected by a localhost same-origin guard and must not simply have that guard removed.

## Undo and file ownership

The existing history store persists bounded history (up to 100 entries and 16 MiB) on the server filesystem, uses hashed file paths for history filenames and restrictive file permissions, and reconciles persisted history against current saved file content on reload.

Target: implement the same semantics in Android app-private storage (transactional database or atomic local files), with explicit local backups/export. Do not upload all editor history to the cloud by default.

## Required new boundaries

1. Android local workspace adapter: project metadata, file CRUD, editor history, undo/redo, and local export/import.
2. Authenticated cloud API: device/user authentication, authorization, token rotation, request validation, per-user quotas, audit events, and TLS-only transport.
3. AI gateway: accepts explicit user-approved prompts and only selected project context required for the operation; keeps Groq credentials server-side.
4. Job API: submit/status/cancel/result for build and verification tasks. Bind every job to authenticated owner.
5. Disposable worker: copy bounded snapshot into sandbox, run approved build/test steps, enforce CPU/memory/disk/time limits, restrict network egress, and destroy worker and task snapshot after retention window.
6. Local apply/rollback: return proposed file diffs/artifacts to phone; require explicit user approval and verify base hashes before applying, preserving conflict-safe rollback model.

## Implementation blockers / decisions

- Existing companion Android sources live in PR #107 (android-companion/) and are not part of audited main tree. Standalone work must explicitly integrate that client source or replace it; it must not assume it already exists on main.
- No cloud host/provider, region, account ownership, or deployment credentials have been selected. Do not provision or publish infrastructure until specified.
- No cloud identity provider has been selected. Prefer a managed identity service or a small, reviewed authentication layer; do not invent an insecure custom password/token scheme.
- Current Docker runner is networkless and depends on a pre-populated trusted npm cache. Cloud workers need a documented package acquisition strategy that preserves dependency integrity without unrestricted project egress.
- Physical Samsung device validation remains mandatory; CI APK compilation alone is not proof of standalone behavior.

## Recommended delivery order

1. Keep Android local workspace as source of truth and introduce explicit storage interface without changing desktop behavior.
2. Add authenticated API contracts and tests first; keep current localhost endpoints and protections intact.
3. Extract Groq invocation behind server-only gateway and add shared per-user quotas and cost accounting.
4. Implement task snapshot upload, job lifecycle, bounded result retrieval, and verified deletion.
5. Implement cloud worker isolation and prove cleanup, resource limits, network policy, and cross-user isolation.
6. Integrate Android client with secure token storage and offline local project operations.
7. Add integration tests, run CI, build APK, and perform end-to-end tests on physical Samsung device with no computer attached.

## Security non-goals

- No Groq key in APK, app resources, client environment, logs, or source maps.
- No unauthenticated public build endpoint.
- No arbitrary shell/host command API.
- No public deployment or production secret setup as part of this audit.
- No merge to main without explicit approval.

## Android companion code audit (PR #107)

The proposed client in PR #107 is a minimal Java Activity containing a WebView hard-coded to http://127.0.0.1:3000. It displays USB ADB reverse-tunnel troubleshooting and has no remote API client, local project database, local file workspace, or offline project lifecycle. Its manifest currently enables cleartext traffic globally. That setting is acceptable only for the explicitly local development companion; it must be removed for the standalone production client, which must use HTTPS-only network security configuration. The current Activity also restricts navigation to loopback hosts, so it must be redesigned for the authenticated cloud origin while retaining strict origin allowlisting and safe external-link handling.

PR #107 remains open and unmerged. Its Android source is not present in main. The standalone branch was created from main, so it does not inherit the companion implementation. Integration must be an explicit next change (port/rebuild the client or merge the companion branch as a starting point); do not silently assume Android sources exist in this branch.
