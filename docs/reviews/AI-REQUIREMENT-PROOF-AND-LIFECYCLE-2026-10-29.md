# AI Requirement Evidence and Full Lifecycle Proof — 2026-10-29

- Repository: `AligasSRM/Alex-Studio`
- Work branch: `feat/ai-requirement-proof-e2e-2026-10-29`
- Base commit: `a60eb3caa465aa1ab36b849ab7311f4e1688e64b`
- Status: implementation proposed; acceptance remains OPEN until CI and the gated live workflow produce evidence.
- Scope: deterministic requirement evidence plus a real-provider, real-Docker generation → verification/repair → apply integration test.
- `main` is not modified by this work.

## Requirement evidence

The isolated browser runner now emits its observed document title, visible body text, and browser errors as a structured payload. The acceptance layer evaluates only these explicit deterministic requirement forms:

- `title is "Exact document title"`
- `page contains text "Visible text"`
- `page does not contain text "Forbidden visible text"`

A deterministic assertion receives `PASS` only when the actual browser snapshot proves it. A mismatch is `FAIL` and is included in the diagnostics that drive the bounded repair loop. Unsupported or subjective requirements remain `UNVERIFIED`; no AI self-report or generic smoke-test pass can promote them to `PASS`.

The build prompt asks the provider to express requirements in the supported syntax when they can be verified from rendered title/body text. Requirements involving visual quality, real form submission, external services, accessibility semantics, responsive breakpoints, or other unsupported behavior require dedicated tests or manual review and must remain unverified until such evidence exists.

## Full lifecycle integration test

`tests/ai-lifecycle.live.integration.test.ts` is explicitly gated by `RUN_FULL_AI_LIFECYCLE=1`. It uses the real configured AI provider and actual Docker browser runner to:

1. Create an isolated project and preserve the original file hash/content.
2. Request a page with an exact title and visible marker.
3. Deliberately corrupt the marker in the in-memory draft only.
4. Run isolated browser verification; require the broken marker to fail.
5. Let the real AI repair route attempt the repair within the existing two-round bound.
6. Require both deterministic requirements to pass with evidence from the post-repair browser snapshot.
7. Confirm the saved project stayed unchanged until apply.
8. Apply only the verified final draft using the server-issued proof and explicit approval.
9. Read the persisted file back and assert the requested title and marker are present and the injected broken marker is absent.

The live workflow is manual to avoid surprise provider charges and requires the repository secret `GROQ_API_KEY`. Before merging this PR, use the existing `Live AI provider proof` workflow, select this PR branch, set `run_provider_smoke` to false and `run_full_lifecycle` to true. That workflow exists on the default branch, so it can dispatch against the proposed branch without merging the implementation first. It pins the approved Playwright image by digest, checks Docker availability, and runs the gated integration test. The new standalone `Full AI lifecycle proof` workflow can be used for repeatable post-merge proof. Normal PR CI runs the deterministic unit tests; the real-provider lifecycle proof must be triggered separately.

## Acceptance criteria

- [ ] PR CI passes on the exact latest head SHA.
- [ ] Real Docker runner integration passes on the exact latest head SHA.
- [ ] Manual full lifecycle workflow passes with the real provider and Docker.
- [ ] The test report records the run URL, commit SHA, repair round, requirement evidence, and apply result.
- [ ] No requirement is marked PASS without a supported assertion and a captured browser snapshot.
- [ ] Subjective/unsupported requirements remain UNVERIFIED.
- [ ] No merge to `main` occurs until the owner reviews the evidence and explicitly authorizes merge.

## Important limitation

This is not a universal natural-language theorem prover. It provides deterministic evidence for a small, explicit set of rendered-page assertions and a real lifecycle test for that path. Other requirement classes need additional typed assertions (for example, selector visibility, form validation, keyboard accessibility, mobile viewport behavior, or side-effect verification) and their own tests before they can be marked PASS.
