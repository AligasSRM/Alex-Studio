import fs from 'node:fs';
import { POST as buildPost } from '../app/api/ai/build/route';
import { POST as createProjectPost } from '../app/api/projects/route';
import { projectRoot } from '../lib/path-security';
import { readProjectFile } from '../lib/files';
import { resetRateLimitsForTests } from '../lib/rate-limit';

const createdIds: string[] = [];
const liveTest = process.env.RUN_REAL_OPENAI_INTEGRATION === '1' ? it : it.skip;

function localPost(url: string, body: string) {
  return new Request(url, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body,
  });
}

async function makeProject() {
  const response = await createProjectPost(localPost(
    'http://localhost:3000/api/projects',
    JSON.stringify({ name: 'Live AI Provider Proof ' + Date.now() }),
  ));
  if (!response.ok) throw new Error('Could not create isolated test project');
  const data = await response.json() as { project: { id: string } };
  createdIds.push(data.project.id);
  return data.project.id;
}

afterEach(() => {
  jest.restoreAllMocks();
  resetRateLimitsForTests();
  for (const id of createdIds.splice(0)) {
    fs.rmSync(projectRoot(id), { recursive: true, force: true });
  }
});

describe('live OpenAI provider proof (explicitly gated)', () => {
  liveTest('calls the real provider through the build route and leaves original files unchanged', async () => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for this explicitly enabled live integration test');
    }

    const id = await makeProject();
    const original = readProjectFile(id, 'index.html');
    const requestBody = JSON.stringify({
      projectId: id,
      approved: true,
      prompt: 'Make a minimal single-page portfolio. Return one small complete index.html file with a title and one heading. Keep it simple.',
    });
    let response: Response | undefined;

    // Provider-side 429s are surfaced by the route as a retryable 503. Retry only
    // that known transient response, with a bounded delay; do not hide other errors.
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await buildPost(localPost('http://localhost:3000/api/ai/build', requestBody));
      if (response.ok) break;

      const payload = await response.json().catch(() => ({})) as { error?: string };
      const retryableBusy = response.status === 503 && payload.error === 'AI provider is busy; try again later';
      if (!retryableBusy || attempt === 2) {
        throw new Error(`Live AI build route returned HTTP ${response.status}: ${payload.error ?? 'unknown error'}`);
      }

      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader && /^[0-9]{1,5}$/.test(retryAfterHeader)
        ? Number(retryAfterHeader)
        : 2 ** (attempt + 1);
      const delayMs = Math.min(20_000, Math.max(1_000, retryAfterSeconds * 1_000));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (!response?.ok) throw new Error('Live AI build route did not return a successful response after retries');

    const data = await response.json() as {
      build?: { summary?: string; plan?: string[]; requirements?: string[]; files?: { path: string; content: string; baseHash: string | null }[] };
      usage?: { inputTokens: number | null; outputTokens: number | null };
    };

    expect(typeof data.build?.summary).toBe('string');
    expect(data.build?.plan?.length).toBeGreaterThan(0);
    expect(data.build?.requirements?.length).toBeGreaterThan(0);
    expect(data.build?.files?.length).toBeGreaterThan(0);
    expect(data.build?.files?.length).toBeLessThanOrEqual(10);
    expect(data.build?.files?.every(file => typeof file.path === 'string' && typeof file.content === 'string')).toBe(true);
    expect(typeof data.usage?.inputTokens).toBe('number');
    expect(typeof data.usage?.outputTokens).toBe('number');
    expect(readProjectFile(id, 'index.html')).toBe(original);
  }, 90_000);
});
