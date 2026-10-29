# Alex Studio — Full Audit and Remediation Log

Date: 2026-10-29  
Repository: `AligasSRM/Alex-Studio`  
Scope: source audit, remediation evidence, and current product-scope decisions.  
Boundary: changes are proposed through a separate branch/PR; `main` is not edited directly.

## Findings and remediation

| ID | Priority | Finding | Current status / remediation | Evidence status |
|---|---|---|---|---|
| AS-AUD-01 | P1 | The npm command runner accepted any syntactically valid Playwright image digest rather than only a reviewed image. | Exact-match allowlist for the single reviewed image; regression tests reject alternate tags and digests; manual Docker workflow uses the same exact-match check. | PR #90 CI and Docker integration passed on the tested PR head. These are pre-merge results, not independent post-merge checks on `main`. |
| AS-AUD-02 | P1 | Browser smoke-test path used a mutable image tag and did not verify container cleanup after timeout/error. Real-Docker runs exposed image-version mismatch and browser crashes under the previous resource limits. | Digest-pinned Playwright 1.64.1 Noble image, named container, cleanup verification after timeout/error/close, fail-closed behavior if cleanup cannot be verified, and 768 MiB RAM / 128 MiB shared memory budget. | PR #90 Docker runner integration passed on the tested PR head. Post-merge verification on `main` is still needed. |
| AS-AUD-03 | P2 | Iterate endpoint read the entire request body before enforcing the byte limit when Content-Length was absent or inaccurate. | Uses shared streaming `readJsonBody` helper with a 3 MiB limit. | Included in the PR verification gate; retain regression coverage for missing/inaccurate Content-Length. |
| AS-AUD-04 | P2 | Repair endpoint did not select Ollama although the build endpoint supports it. | Provider/model selection, request format, response extraction, and usage-cost handling aligned for OpenAI, Groq, and Ollama. | Keep provider-specific regression tests and exact-commit CI evidence as acceptance evidence. |
| AS-AUD-05 | P2 | Docker integration workflow path filters omitted the browser runner route. | Adds `app/api/ai/iterate/route.ts` to pull-request and main-push path filters. | Confirm main-push workflow runs on the merged commit; PR-triggered integration passed on the tested PR head. |
| AS-AUD-06 | P2 | ESLint major version did not match the Next.js 16 configuration requirements. | **Resolved in PR #89**, which aligned ESLint 10 with Next 16 configuration. The earlier statement that this remains open is stale. | PR #89 was merged. Verify checks on the current `main` commit independently before final release acceptance. |
| AS-AUD-07 | P2 | README release-readiness text was stale and listed implemented provider/rate-limit/usage features as entirely outstanding. | README status language was corrected; implementation existence remains distinct from end-to-end acceptance. | Documentation update does not itself prove runtime acceptance. |

## Required verification before calling the remediation fully green

1. Run and inspect CI against the exact current `main` SHA: lockfile provenance, `npm ci`, dependency audit, unit tests, TypeScript, ESLint, production build, and browser acceptance.
2. Confirm Docker runner integration against the exact current `main` SHA using the approved image digest.
3. Inspect evidence for timeout cleanup, unavailable Docker daemon, alternate image rejection, streaming oversized-body rejection, and provider behavior.
4. Review the full relevant diffs and confirm the repair endpoint cannot apply generated project files without the required explicit approval flow.
5. Keep `main` unchanged except through reviewed pull requests.

## Product scope and remaining release gates

- **Authentication is not a required feature for the current scope.** The owner has explicitly defined Alex Studio as a private application, not a public multi-user service. Do not list missing public multi-user authentication as a release blocker or add login/accounts solely to make the product public.
- Private scope does not remove the need for appropriate local access controls, secret protection, safe file handling, explicit approval before applying changes, or isolation of generated-code execution.
- Passing CI does not prove the complete user-facing lifecycle: generate → review → explicit approval → isolated execution → diagnosis → bounded repair → re-test → apply/rollback, with truthful evidence at each step.
- Performance thresholds and the remaining release-level security review still need evidence.
- Dependency advisories must be evaluated from the audit artifact produced for the exact tested commit; historical counts must not be presented as current.
- Open/empty pull requests are repository-hygiene work and must be reviewed individually. This audit does not authorize merging or closing them.

## Current state

PR #89 (ESLint/Next configuration alignment) and PR #90 (Docker timeout cleanup race) are merged. The current `main` commit was confirmed to match PR #90's merge commit `e9cffb4e46605706152ec041a9fb6d3fc04b99e4`. PR #90's CI and Docker runner integration passed on the tested PR head. Independent post-merge CI and Docker evidence on `main` has not yet been established here, so full release acceptance remains open.

The authentication item is closed as out of scope by owner decision; it is not a code defect to fix. The full AI lifecycle, exact-`main` runtime evidence, performance thresholds, and final security review remain open.
