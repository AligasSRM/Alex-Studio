import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { POST as iteratePost } from '../app/api/ai/iterate/route';
import { POST as createProjectPost } from '../app/api/projects/route';
import { projectRoot } from '../lib/path-security';
import { readProjectFile } from '../lib/files';
import { resetRateLimitsForTests } from '../lib/rate-limit';

const ids: string[] = [];
const originalKey = process.env.OPENAI_API_KEY;
function localPost(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function project() {
  const response = await createProjectPost(localPost('http://localhost:3000/api/projects', { name: 'AI Iterate Test ' + Date.now() }));
  const data = await response.json() as { project: { id: string } };
  ids.push(data.project.id);
  return data.project.id;
}
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
afterEach(() => {
  jest.restoreAllMocks();
  resetRateLimitsForTests();
  for (const id of ids.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
});

describe('isolated AI verify and repair loop', () => {
  it('requires explicit approval before paid repair calls', async () => {
    const id = await project();
    const response = await iteratePost(localPost('http://localhost:3000/api/ai/iterate', {
      projectId: id, prompt: 'Build a site', files: [{ path: 'index.html', content: '<h1>Draft</h1>', baseHash: null }],
    }));
    expect(response.status).toBe(409);
  });

  it('rejects a stale draft before invoking the sandbox', async () => {
    const id = await project();
    process.env.OPENAI_API_KEY = 'test-server-secret';
    const before = readProjectFile(id, 'index.html');
    const response = await iteratePost(localPost('http://localhost:3000/api/ai/iterate', {
      projectId: id, prompt: 'Improve the page', approved: true,
      files: [{ path: 'index.html', content: '<h1>Draft</h1>', baseHash: hash('stale content') }],
    }));
    expect(response.status).toBe(400);
    expect(readProjectFile(id, 'index.html')).toBe(before);
  });

  it('rejects protected file paths without writing project files', async () => {
    const id = await project();
    process.env.OPENAI_API_KEY = 'test-server-secret';
    const response = await iteratePost(localPost('http://localhost:3000/api/ai/iterate', {
      projectId: id, prompt: 'Change configuration', approved: true,
      files: [{ path: '.env', content: 'SECRET=not-real', baseHash: null }],
    }));
    expect(response.status).toBe(400);
  });
});
