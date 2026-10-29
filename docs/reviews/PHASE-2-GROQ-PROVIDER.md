# Phase 2 — Groq provider setup and verification

## Scope

This change adds Groq support to the AI build, text generation, and verify/repair routes. It does not close Phase 2 and does not authorize Phase 3 work.

## Configuration

Set these environment variables in the environment where Alex Studio runs:

- `AI_PROVIDER=groq`
- `GROQ_API_KEY` — secret value from Groq Console; never commit it or print it in logs.
- `GROQ_MODEL=openai/gpt-oss-20b` (optional; this is the default model ID used by this change).

The GitHub Actions repository secret `GROQ_API_KEY` is used only by the protected live-provider workflow. It does not automatically configure a separate local Alex Studio process; set the variables in that runtime's environment too.

Official references:
- Groq Responses API: https://console.groq.com/docs/responses-api
- Groq supported models: https://console.groq.com/docs/models
- Groq rate limits: https://console.groq.com/docs/rate-limits

## Cost and limits

The application records Groq usage tokens when the provider returns them, but deliberately records `estimatedCostUsd: null` instead of pretending that Groq is guaranteed to cost zero. Free-tier availability, quotas, model access, and rate limits depend on the account and can change. Check the current plan and limits in Groq Console before relying on the provider for ongoing use.

## Verification requirements

1. CI must pass unit tests, type check, lint, production build, browser acceptance, and source archive validation.
2. Unit tests must prove Groq selection works without `OPENAI_API_KEY`, that the request uses the Groq Responses API endpoint, and that the API key is never returned to the caller.
3. The protected live-provider workflow must make a real request through `/api/ai/build`, validate the returned draft and usage, and verify that the original project file remains unchanged.
4. Do not mark Phase 2 complete unless the final main commit and the real provider proof both pass. Do not weaken or skip a failing live test.
