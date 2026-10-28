import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectGeneratedProject, runProjectCommands } from '../lib/ai-command-runner';

const roots: string[] = [];
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-test-'));
  roots.push(root);
  return root;
}
function write(root: string, name: string, content: string) {
  fs.writeFileSync(path.join(root, name), content, 'utf8');
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('isolated npm runner preflight', () => {
  it('treats a static project without package.json as browser-only', async () => {
    const root = workspace();
    const plan = inspectGeneratedProject(root);
    expect(plan.kind).toBe('static');
    await expect(runProjectCommands(root)).resolves.toMatchObject({
      ok: true, available: true, status: 'PASS', commands: [],
    });
  });

  it('fails closed when an npm project has no lockfile', async () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({
      name: 'demo', version: '1.0.0', scripts: { build: 'node build.js', test: 'node test.js' },
    }));
    const result = await runProjectCommands(root);
    expect(result.available).toBe(false);
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.output).toContain('package-lock.json is required');
  });

  it('requires build and test scripts and records missing scripts as NOT RUN', () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { lint: 'eslint .' } }));
    write(root, 'package-lock.json', JSON.stringify({
      name: 'demo', version: '1.0.0', lockfileVersion: 3,
      packages: { '': { name: 'demo', version: '1.0.0' } },
    }));
    const plan = inspectGeneratedProject(root);
    expect(plan.preflightError).toBeNull();
    expect(plan.scripts.map(script => script.name)).toEqual(['build', 'test', 'lint']);
  });

  it('rejects unsupported package managers and malformed lockfile versions', () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({
      name: 'demo', version: '1.0.0', packageManager: 'pnpm@9.0.0',
      scripts: { build: 'node build.js', test: 'node test.js' },
    }));
    expect(inspectGeneratedProject(root).preflightError).toContain('Only npm');
    write(root, 'package.json', JSON.stringify({
      name: 'demo', version: '1.0.0', scripts: { build: 'node build.js', test: 'node test.js' },
    }));
    write(root, 'package-lock.json', JSON.stringify({ lockfileVersion: 1, packages: {} }));
    expect(inspectGeneratedProject(root).preflightError).toContain('lockfileVersion 2 or 3');
  });
});
