import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { POST as buildPost } from '../app/api/ai/build/route';
import { POST as applyPost } from '../app/api/ai/apply/route';
import { POST as createProjectPost } from '../app/api/projects/route';
import { projectRoot } from '../lib/path-security';
import { readProjectFile } from '../lib/files';
import { resetRateLimitsForTests } from '../lib/rate-limit';

const createdIds: string[] = [];
const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;
function localPost(url: string, body: string) {
  return new Request(url, {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body,
  });
}
async function makeProject() {
  const response = await createProjectPost(localPost('http://localhost:3000/api/projects', JSON.stringify({ name: 'AI Build Test ' + Date.now() })));
  const data = await response.json() as { project: { id: string } };
  createdIds.push(data.project.id);
  return data.project.id;
}
function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
afterEach(() => {
  jest.restoreAllMocks();
  resetRateLimitsForTests();
  for (const id of createdIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel;
});

describe('AI project build workflow', () => {
  it('requires explicit approval before paid build generation', async () => {
    const id = await makeProject();
    const response = await buildPost(localPost('http://localhost:3000/api/ai/build', JSON.stringify({ projectId: id, prompt: 'Build a portfolio' })));
    expect(response.status).toBe(409);
  });

  it('does not change project files while preparing a draft', async () => {
    const id = await makeProject();
    process.env.OPENAI_API_KEY = 'test-server-secret';
    const original = readProjectFile(id, 'index.html');
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        summary: 'Improve the home page',
        plan: ['Update the page heading'],
        requirements: ['The page title must be Draft.'],
        files: [{ path: 'index.html', content: '<!doctype html><title>Draft</title>' }],
      }),
      usage: { input_tokens: 12, output_tokens: 24 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await buildPost(localPost('http://localhost:3000/api/ai/build', JSON.stringify({
      projectId: id, prompt: 'Update the home page', approved: true,
    })));
    expect(response.status).toBe(200);
    const data = await response.json() as { build: { files: { path: string; baseHash: string | null }[] } };
    expect(data.build.files[0].path).toBe('index.html');
    expect(data.build.files[0].baseHash).toBe(hash(original));
    expect(readProjectFile(id, 'index.html')).toBe(original);
  });

  it('requires explicit approval and rejects protected paths when applying a draft', async () => {
    const id = await makeProject();
    const denied = await applyPost(localPost('http://localhost:3000/api/ai/apply', JSON.stringify({
      projectId: id, files: [{ path: 'index.html', content: 'x', baseHash: hash(readProjectFile(id, 'index.html')) }],
    })));
    expect(denied.status).toBe(409);
    const protectedPath = await applyPost(localPost('http://localhost:3000/api/ai/apply', JSON.stringify({
      projectId: id, approved: true, files: [{ path: '.env', content: 'SECRET=x', baseHash: null }],
    })));
    expect(protectedPath.status).toBe(400);
  });

  it('applies a reviewed multi-file batch and refuses stale drafts', async () => {
    const id = await makeProject();
    const current = readProjectFile(id, 'index.html');
    const stale = await applyPost(localPost('http://localhost:3000/api/ai/apply', JSON.stringify({
      projectId: id, approved: true, files: [{ path: 'index.html', content: '<h1>stale</h1>', baseHash: hash('not-current') }],
    })));
    expect(stale.status).toBe(409);
    expect(readProjectFile(id, 'index.html')).toBe(current);

    const response = await applyPost(localPost('http://localhost:3000/api/ai/apply', JSON.stringify({
      projectId: id, approved: true, files: [
        { path: 'index.html', content: '<!doctype html><title>Updated</title>', baseHash: hash(current) },
        { path: 'app.js', content: 'document.body.dataset.ready = "true";', baseHash: null },
      ],
    })));
    expect(response.status).toBe(200);
    const data = await response.json() as { count: number; applied: string[] };
    expect(data.count).toBe(2);
    expect(data.applied).toEqual(['index.html', 'app.js']);
    expect(readProjectFile(id, 'index.html')).toContain('Updated');
    expect(readProjectFile(id, 'app.js')).toContain('dataset.ready');
  });
});
