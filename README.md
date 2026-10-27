# Alex Studio

Alex Studio is a **local-first project workspace** for creating small web projects, editing project files, reviewing a proposed diff, and applying a change only after explicit approval.

> Current engineering status: **A0 — OPEN.** The repository is under active remediation. Do not treat it as production-ready until the CI gates pass and the acceptance checklist is completed.

## Local development

Requirements: Node.js 24 and npm.

\`\`\`bash
npm ci
npm run dev
\`\`\`

The development server is configured to bind to \`127.0.0.1\` only. Open the local address printed by Next.js on the same device. Do not expose this app to a LAN or the internet: authentication and multi-user authorization are not implemented.

## Commands

- \`npm run dev\` — start the local development server.
- \`npm run typecheck\` — TypeScript check without emitting files.
- \`npm run lint\` — ESLint.
- \`npm test\` — filesystem, project-operation, and checksum tests.
- \`npm run build\` — production build.
- \`npm start\` — start the production server on loopback.

## Current workflow

1. Create a project in **Projects**.
2. Open the project and select a file.
3. Edit the content in the editor.
4. Choose **Review proposed change** to prepare a draft.
5. Inspect the real diff. The review screen checks that the source file still matches the original hash.
6. Approve to apply the change, or reject it. After approval, Alex Studio reads the file back and verifies its hash.

Draft content is held in the browser's session storage until review is completed. File reads and writes are scoped to a validated project path. Backups are created before replacing an existing file.

## AI configuration

Copy \`.env.local.example\` to \`.env.local\` and configure \`AI_API_KEY\`, \`AI_API_URL\`, and \`AI_MODEL\` to use a real provider. Without a key, chat returns a configuration error. Mock responses are allowed only when \`AI_ALLOW_MOCK=true\` in development and are never used in production.

The token count shown by the current UI is an estimate. Persistent provider-reported usage, monthly spend aggregation, and hard monthly budget enforcement are **not implemented yet**.

## Security boundaries

- Keep the server bound to loopback.
- File paths must be relative to a validated project; \`.alex\`, \`.git\`, and \`node_modules\` are not exposed through project file APIs.
- The apply endpoint supports an expected SHA-256 value to detect a stale review.
- Project names are escaped before insertion into the starter HTML.
- Symlink checks, backups, and atomic writes reduce risk but do not eliminate all filesystem race conditions.
- No authentication or multi-user authorization is implemented. Do not deploy this build as a shared service.

## Acceptance roadmap

See [A0–A5 engineering gates](docs/engineering/ACCEPTANCE-GATES-A0-A5.md). A stage is not closed by code changes alone; its checks and evidence must pass.

## Known gaps

- AI-generated changes are not yet converted automatically into a structured, project-scoped change plan.
- Persistent AI usage/cost tracking and hard budget enforcement are not implemented.
- ZIP export with secret exclusions is not implemented.
- Browser-level end-to-end coverage and real-world preview isolation checks are still required.
- Git-based project history, rollback UX, and recovery tests need further work.
- Authentication and authorization are not implemented; the application must remain local-only.
