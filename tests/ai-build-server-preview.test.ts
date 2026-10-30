import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBuildServerPreview } from '../lib/ai-build-server-preview';

const roots: string[] = [];
function project(scripts: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-build-preview-unit-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'preview-unit', version: '1.0.0', scripts }));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('build/server preview preflight', () => {
  it('does not claim an npm project passed when no supported server script exists', async () => {
    const result = await runBuildServerPreview(project({ build: 'node build.js' }));
    expect(result).toMatchObject({ ok: false, available: false, status: 'UNAVAILABLE' });
    expect(result.summary).toContain('build and start');
  });

  it('reports a missing offline cache as UNAVAILABLE before starting Docker', async () => {
    const previous = process.env.AI_RUNNER_NPM_CACHE;
    delete process.env.AI_RUNNER_NPM_CACHE;
    try {
      const result = await runBuildServerPreview(project({ build: 'node build.js', start: 'node server.js' }));
      expect(result).toMatchObject({ ok: false, available: false, status: 'UNAVAILABLE' });
      expect(result.summary).toContain('offline npm cache');
    } finally {
      if (previous === undefined) delete process.env.AI_RUNNER_NPM_CACHE;
      else process.env.AI_RUNNER_NPM_CACHE = previous;
    }
  });

  it('rejects a symbolic-link workspace before invoking Docker', async () => {
    const root = project({ build: 'node build.js', start: 'node server.js' });
    const outside = path.join(os.tmpdir(), 'alex-preview-outside-' + Date.now());
    fs.writeFileSync(outside, 'not part of the project');
    fs.symlinkSync(outside, path.join(root, 'escape.txt'));
    try {
      const previous = process.env.AI_RUNNER_NPM_CACHE;
      process.env.AI_RUNNER_NPM_CACHE = os.tmpdir();
      const result = await runBuildServerPreview(root);
      expect(result).toMatchObject({ ok: false, available: false, status: 'UNAVAILABLE' });
      expect(result.summary).toContain('safely');
      if (previous === undefined) delete process.env.AI_RUNNER_NPM_CACHE;
      else process.env.AI_RUNNER_NPM_CACHE = previous;
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
