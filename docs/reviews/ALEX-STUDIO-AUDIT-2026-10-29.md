# Alex Studio — Full Audit and Remediation Log

Date: 2026-10-29  
Repository: `AligasSRM/Alex-Studio`  
Scope: read-only source audit followed by remediation on `fix/allowlist-approved-docker-runner-image-2026-10-29`.  
Boundary: `main` was not edited directly. No PR was merged.

## Findings and remediation

| ID | Priority | Finding | Remediation in this branch | Evidence status |
|---|---|---|---|---|
| AS-AUD-01 | P1 | The npm command runner accepted any syntactically valid Playwright image digest rather than only a reviewed image. | Exact-match allowlist for the single reviewed image; regression tests reject alternate tags and digests; manual Docker workflow uses the same exact-match check. | Unit and real-Docker CI required on final head. |
| AS-AUD-02 | P1 | The browser smoke-test path used a mutable image tag without a digest and did not verify container cleanup after timeout/error. Real-Docker runs exposed two further defects: the image version was behind the installed Playwright package, and the browser crashed under the 256 MiB/64 MiB shared-memory limits. | Uses an exact digest-pinned Playwright 1.64.1 Noble image, a named container, cleanup verification after timeout/error/close, fails closed if cleanup cannot be verified, and raises the browser container budget to 768 MiB RAM / 128 MiB shared memory. | CI and real-Docker integration must pass on the final head. The resource-limit adjustment still needs successful runtime confirmation. |
| AS-AUD-03 | P2 | The iterate endpoint read the entire request body before enforcing the byte limit when Content-Length was absent or inaccurate. | Uses the shared streaming `readJsonBody` helper with the 3 MiB limit. | Existing request-body and iterate regression tests plus CI required. |
| AS-AUD-04 | P2 | The repair endpoint did not select Ollama even though the build endpoint supports it. | Aligns provider selection, model selection, request format, response extraction, and usage-cost handling for OpenAI, Groq, and Ollama. | Type/unit tests and provider-specific regression evidence required. |
| AS-AUD-05 | P2 | Docker integration workflow path filters did not include the browser runner route. | Adds `app/api/ai/iterate/route.ts` to both pull-request and main-push path filters. | Verify workflow is triggered on the final head. |
| AS-AUD-06 | P2 | `eslint-config-next` is on a different major version line from Next.js. | Investigated a coordinated upgrade. Updating only `eslint-config-next` to 16.4.3 fails `npm ci` because it requires ESLint >=9 while the project pins ESLint 8.57.1. The attempted package/lockfile change was reverted rather than bypassing peer checks. | **Open:** coordinate an ESLint major upgrade with a regenerated and provenance-valid lockfile, then rerun the complete CI gate. |
| AS-AUD-07 | P2 | README release-readiness text was stale and listed already-implemented provider/rate-limit/usage features as entirely outstanding. | Corrects the status language and points to this audit; keeps production approval separate from implementation existence. | Documentation review complete; does not itself prove runtime acceptance. |

## Required verification before calling this remediation green

1. Alex Studio CI passes on the exact final PR head: lockfile provenance, `npm ci`, dependency audit, unit tests, TypeScript, ESLint, production build, and browser acceptance.
2. Docker runner integration passes on the exact final PR head using the exact approved image digest.
3. Inspect test evidence for timeout cleanup, unavailable Docker daemon, alternate image rejection, streaming oversized-body rejection, and provider behavior.
4. Review the full PR diff and confirm no generated project files are applied by the repair endpoint.
5. Keep `main` unchanged until the project owner separately authorizes merge.

## Remaining product/release gates

- No user authentication exists; the application remains local-only and must not be deployed as a public multi-user service.
- Passing CI does not prove the full generate → review → explicit approval → isolated execution → diagnosis → bounded repair → re-test → apply/rollback lifecycle in a real user session.
- Performance thresholds and complete release-level security review still need evidence.
- Dependency advisories must be evaluated from the audit artifact produced for the exact tested commit; historical counts must not be presented as current.
- Open/empty pull requests are repository hygiene work and must be reviewed individually; this audit does not merge or close them.

## Current state

The code and workflow changes are proposed on the branch named above. The dependency-major upgrade remains open because the first attempt failed the peer-dependency check; it was reverted. This report does not claim that CI passed on the final head until workflow runs have completed and their exact commit SHA has been checked.
