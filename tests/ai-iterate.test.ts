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

  it('rejects environment variants and secret paths', async () => {
    const id = await project();
    process.env.OPENAI_API_KEY = 'test-server-secret';
    for (const filePath of ['.env.local', 'config/credentials.json', 'secrets.json']) {
      const response = await iteratePost(localPost('http://localhost:3000/api/ai/iterate', {
        projectId: id, prompt: 'Change configuration', approved: true,
        files: [{ path: filePath, content: 'NOT_A_REAL_SECRET', baseHash: null }],
      }));
      expect(response.status).toBe(400);
    }
  });

  it('rejects oversized request bodies before JSON parsing or sandbox execution', async () => {
    const id = await project();
    const request = new Request('http://localhost:3000/api/ai/iterate', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: id, prompt: 'x'.repeat(3 * 1024 * 1024), approved: true, files: [] }),
    });
    const response = await iteratePost(request);
    expect(response.status).toBe(413);
  });

  it('rejects AI repair changes to package lockfiles before provider or sandbox access', async () => {
    const id = await project();
    process.env.OPENAI_API_KEY = 'test-server-secret';
    const before = readProjectFile(id, 'index.html');
    const response = await iteratePost(localPost('http://localhost:3000/api/ai/iterate', {
      projectId: id, prompt: 'Change the package lockfile', approved: true,
      files: [{ path: 'package-lock.json', content: '{"lockfileVersion":3}', baseHash: null }],
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/protected or non-canonical path/i);
    expect(readProjectFile(id, 'index.html')).toBe(before);
    expect(fs.existsSync(projectRoot(id) + '/package-lock.json')).toBe(false);
  });

});
