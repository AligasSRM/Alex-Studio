import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { POST as buildPost } from '../app/api/ai/build/route';
import { createProject } from '../lib/project-store';
import { listProjectFiles, readProjectFile } from '../lib/files';
import { projectRoot } from '../lib/path-security';
import { resetRateLimitsForTests } from '../lib/rate-limit';

const createdIds: string[] = [];
const originalKey = process.env.OPENAI_API_KEY;
const originalProvider = process.env.AI_PROVIDER;

function localPost(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  resetRateLimitsForTests();
  for (const id of createdIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalProvider;
});

describe('Phase 1 performance guardrails (local CI baseline)', () => {
  it('loads a 100-file project within the 2-second file-loading budget', () => {
    const project = createProject('Phase 1 Performance ' + Date.now());
    createdIds.push(project.id);
    const root = projectRoot(project.id);
    const sample = '<section><h1>Performance fixture</h1><p>' + 'x'.repeat(2048) + '</p></section>';
    for (let index = 0; index < 100; index++) {
      const directory = path.join(root, 'pages');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'page-' + index + '.html'), sample);
    }

    const samplesMs: number[] = [];
    for (let sampleIndex = 0; sampleIndex < 5; sampleIndex++) {
      const start = performance.now();
      const files = listProjectFiles(project.id).filter((file) => file.type === 'file');
      for (const file of files) readProjectFile(project.id, file.path);
      samplesMs.push(performance.now() - start);
    }

    expect(samplesMs).toHaveLength(5);
    expect(listProjectFiles(project.id).filter((file) => file.type === 'file')).toHaveLength(103);
    expect(Math.max(...samplesMs)).toBeLessThan(2000);
  });

  it('returns a provider-mocked AI build draft within the 10-second API budget', async () => {
    const project = createProject('Phase 1 API Performance ' + Date.now());
    createdIds.push(project.id);
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'phase1-performance-test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        summary: 'Performance fixture draft',
        plan: ['Update the page title'],
        requirements: ['The page title is Performance Draft.'],
        files: [{ path: 'index.html', content: '<!doctype html><title>Performance Draft</title>' }],
      }),
      usage: { input_tokens: 10, output_tokens: 20 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const start = performance.now();
    const response = await buildPost(localPost('http://localhost:3000/api/ai/build', {
      projectId: project.id,
      prompt: 'Update the page title for a performance test',
      approved: true,
    }));
    const elapsedMs = performance.now() - start;

    expect(response.status).toBe(200);
    expect(elapsedMs).toBeLessThan(10_000);
    const body = await response.json() as { build?: { files?: { path: string }[] } };
    expect(body.build?.files?.[0]?.path).toBe('index.html');
  });
});
