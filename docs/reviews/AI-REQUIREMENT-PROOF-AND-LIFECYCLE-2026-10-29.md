# AI Requirement Evidence and Full Lifecycle Proof — 2026-10-29

- Repository: `AligasSRM/Alex-Studio`
- Evidence record branch: `main` (this report is being committed through a protected-branch PR)
- Live proof run: [Full AI lifecycle proof #1](https://github.com/AligasSRM/Alex-Studio/actions/runs/40956704650)
- Exact tested commit: `6708d200df55afbe71a7aa4ad2e05088014ccdca`
- Live proof result: **PASS** (GitHub Actions conclusion: `success`)
- The proof ran on the exact tested SHA above; this documentation records its results without claiming the documentation commit itself was tested by that run.
- Scope: deterministic requirement evidence plus a real-provider, real-Docker generation → verification/repair → apply integration test.

## Final live acceptance record

The manually dispatched workflow completed successfully on `main`. The job ran with `AI_PROVIDER=groq`, `RUN_FULL_AI_LIFECYCLE=1`, and configured model `openai/gpt-oss-20b`. The secret value was masked in GitHub logs and is intentionally not recorded here.

Verified job steps:
- Locked dependency installation: passed; npm reported 0 vulnerabilities in that install audit.
- Docker daemon verification: passed.
- Approved digest-pinned Playwright browser runner pull: passed for `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea`.
- Real-provider full lifecycle integration test: passed.
- Jest summary: 1 suite passed, 1 test passed.

Captured test evidence from the successful job log:
- Repair rounds: round 1 repaired the draft by updating body text to `AI_LIFECYCLE_MARKER`.
- `REQ-001`: `title is "Alex Studio Lifecycle Proof"` — PASS; observed document title exactly matched.
- `REQ-002`: `page contains text "AI_LIFECYCLE_MARKER"` — PASS; marker was present in visible body text.
- Final lifecycle result: `PASS`; `appliedCount=1`; persisted/verified title `Alex Studio Lifecycle Proof`; verified marker `AI_LIFECYCLE_MARKER`.
- The integration test covers generating a draft, proving requirements, repairing a broken draft, and applying only verified files.

## Requirement evidence model

The isolated browser runner emits its observed document title, visible body text, and browser errors as a structured payload. The acceptance layer evaluates only these explicit deterministic requirement forms:

- `title is "Exact document title"`
- `page contains text "Visible text"`
- `page does not contain text "Forbidden visible text"`

A deterministic assertion receives `PASS` only when the actual browser snapshot proves it. A mismatch is `FAIL` and is included in the diagnostics that drive the bounded repair loop. Unsupported or subjective requirements remain `UNVERIFIED`; no AI self-report or generic smoke-test pass can promote them to `PASS`.

The build prompt asks the provider to express requirements in the supported syntax when they can be verified from rendered title/body text. Requirements involving visual quality, real form submission, external services, accessibility semantics, responsive breakpoints, or other unsupported behavior require dedicated tests or manual review and must remain unverified until such evidence exists.

## Provider JSON reliability finding

An earlier live-provider run on `main` (GitHub Actions run [40931386272](https://github.com/AligasSRM/Alex-Studio/actions/runs/40931386272)) reached the real Groq endpoint but failed while parsing malformed model output. The build and repair requests were subsequently updated to request JSON mode through the Responses API `text.format` setting; the Groq build unit test asserts this request contract. The successful full lifecycle proof linked above now verifies the configured model/provider and Docker path on the exact tested commit.

## Full lifecycle integration test

`tests/ai-lifecycle.live.integration.test.ts` is explicitly gated by `RUN_FULL_AI_LIFECYCLE=1`. The successful run used the real configured AI provider and actual Docker browser runner to:

1. Create an isolated project and preserve the original file hash/content.
2. Request a page with an exact title and visible marker.
3. Deliberately corrupt the marker in the in-memory draft only.
4. Run isolated browser verification and require the broken marker to fail.
5. Let the real AI repair route attempt the repair within the existing two-round bound.
6. Require both deterministic requirements to pass with evidence from the post-repair browser snapshot.
7. Confirm the saved project stayed unchanged until apply.
8. Apply only the verified final draft using the server-issued proof and explicit approval.
9. Read the persisted file back and assert the requested title and marker are present and the injected broken marker is absent.

The workflow is manual to avoid surprise provider charges and requires the repository secret `GROQ_API_KEY`. The successful run proves that the configured secret was available to the job, without exposing its value. The workflow pins the approved Playwright image by digest, checks Docker availability, and runs the gated integration test. Normal PR CI runs the deterministic unit tests; the real-provider lifecycle proof is triggered separately.

## Acceptance criteria — final state for this proof gate

- [x] CI passes on the tested `main` commit (`6708d200df55afbe71a7aa4ad2e05088014ccdca`).
- [x] Docker integration acceptance passes on the tested `main` commit.
- [x] Manual full lifecycle workflow passes with the real provider and Docker: [run #1](https://github.com/AligasSRM/Alex-Studio/actions/runs/40956704650).
- [x] This record preserves the run URL, tested commit SHA, repair round, requirement evidence, and apply result.
- [x] No requirement is marked PASS without a supported assertion and a captured browser snapshot.
- [x] Subjective/unsupported requirements remain UNVERIFIED.

## Remaining limits (not a blocker for this specific lifecycle proof)

This is not a universal natural-language theorem prover. It provides deterministic evidence for a small, explicit set of rendered-page assertions and a real lifecycle test for that path. Other requirement classes need additional typed assertions (for example, selector visibility, form validation, keyboard accessibility, mobile viewport behavior, or side-effect verification) and their own tests before they can be marked PASS. This record closes the live AI lifecycle proof gate only; it does not claim the entire product's performance review, final security review, or all application build/server acceptance gaps are closed.
