import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectGeneratedProject, isPinnedRunnerImage, runProjectCommands, validateProjectTreeLimits } from '../lib/ai-command-runner';

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
  it('requires the trusted Playwright image to be pinned by a SHA-256 digest', () => {
    expect(isPinnedRunnerImage('mcr.microsoft.com/playwright:v1.56.1-noble@sha256:' + 'a'.repeat(64))).toBe(true);
    expect(isPinnedRunnerImage('mcr.microsoft.com/playwright:v1.56.1-noble')).toBe(false);
    expect(isPinnedRunnerImage('docker.io/example/runner:latest@sha256:' + 'a'.repeat(64))).toBe(false);
    expect(isPinnedRunnerImage(undefined)).toBe(false);
  });

  it('rejects project trees larger than the staging byte limit before copying', () => {
    const root = workspace();
    const oversized = path.join(root, 'oversized.bin');
    fs.closeSync(fs.openSync(oversized, 'w'));
    fs.truncateSync(oversized, 100 * 1024 * 1024 + 1);
    expect(() => validateProjectTreeLimits(root)).toThrow('100 MiB staging limit');
  });

  it('rejects symbolic links in generated project trees', () => {
    const root = workspace();
    const target = path.join(root, 'target.txt');
    write(root, 'target.txt', 'safe');
    fs.symlinkSync(target, path.join(root, 'linked.txt'));
    expect(() => validateProjectTreeLimits(root)).toThrow('must not contain symbolic links');
  });

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

  it('requires build and test scripts and records missing scripts as NOT RUN', async () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { lint: 'eslint .' } }));
    write(root, 'package-lock.json', JSON.stringify({
      name: 'demo', version: '1.0.0', lockfileVersion: 3,
      packages: { '': { name: 'demo', version: '1.0.0' } },
    }));
    const plan = inspectGeneratedProject(root);
    expect(plan.preflightError).toBeNull();
    expect(plan.scripts.map(script => script.name)).toEqual(['build', 'test', 'lint']);
    const result = await runProjectCommands(root);
    expect(result.status).toBe('FAIL');
    expect(result.commands.filter(command => command.required).every(command => command.status === 'NOT RUN')).toBe(true);
    expect(result.output).toContain('Required scripts missing');
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

  it('reports missing offline cache configuration as UNAVAILABLE', async () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { build: 'node build.js', test: 'node test.js' } }));
    write(root, 'package-lock.json', JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'demo', version: '1.0.0' } } }));
    const previousCache = process.env.AI_RUNNER_NPM_CACHE;
    const previousImage = process.env.AI_RUNNER_DOCKER_IMAGE;
    delete process.env.AI_RUNNER_NPM_CACHE;
    process.env.AI_RUNNER_DOCKER_IMAGE = 'mcr.microsoft.com/playwright:v1.56.1-noble@sha256:' + 'a'.repeat(64);
    try {
      const result = await runProjectCommands(root);
      expect(result).toMatchObject({ ok: false, available: false, status: 'UNAVAILABLE', summary: 'Offline npm cache is not configured' });
      expect(result.commands.every(command => command.status === 'UNAVAILABLE')).toBe(true);
    } finally {
      if (previousCache === undefined) delete process.env.AI_RUNNER_NPM_CACHE;
      else process.env.AI_RUNNER_NPM_CACHE = previousCache;
      if (previousImage === undefined) delete process.env.AI_RUNNER_DOCKER_IMAGE;
      else process.env.AI_RUNNER_DOCKER_IMAGE = previousImage;
    }
  });

  it('reports an unpinned or missing runner image as UNAVAILABLE before execution', async () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { build: 'node build.js', test: 'node test.js' } }));
    write(root, 'package-lock.json', JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'demo', version: '1.0.0' } } }));
    const previousCache = process.env.AI_RUNNER_NPM_CACHE;
    const previousImage = process.env.AI_RUNNER_DOCKER_IMAGE;
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-cache-test-'));
    roots.push(cache);
    process.env.AI_RUNNER_NPM_CACHE = cache;
    delete process.env.AI_RUNNER_DOCKER_IMAGE;
    try {
      const result = await runProjectCommands(root);
      expect(result).toMatchObject({ ok: false, available: false, status: 'UNAVAILABLE', summary: 'Pinned runner image is not configured' });
      expect(result.commands.every(command => command.status === 'UNAVAILABLE')).toBe(true);
    } finally {
      if (previousCache === undefined) delete process.env.AI_RUNNER_NPM_CACHE;
      else process.env.AI_RUNNER_NPM_CACHE = previousCache;
      if (previousImage === undefined) delete process.env.AI_RUNNER_DOCKER_IMAGE;
      else process.env.AI_RUNNER_DOCKER_IMAGE = previousImage;
    }
  });
});