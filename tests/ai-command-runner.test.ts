import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectGeneratedProject, isPinnedRunnerImage, removeAndVerifyContainer, runProjectCommands, validateProjectTreeLimits } from '../lib/ai-command-runner';

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

describe('isolated runner container cleanup verification', () => {
  it('confirms cleanup only after Docker reports the named container absent', () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-fake-docker-cleanup-'));
    roots.push(fakeBin);
    const fakeDocker = path.join(fakeBin, 'docker');
    fs.writeFileSync(fakeDocker, '#!/bin/sh\nif [ "$1" = "rm" ]; then exit 1; fi\nif [ "$1" = "ps" ]; then exit 0; fi\nexit 2\n', { mode: 0o755 });
    const previousPath = process.env.PATH;
    process.env.PATH = fakeBin;
    try {
      expect(removeAndVerifyContainer('alex-studio-runner-cleanup-test')).toMatchObject({ verified: true });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it('does not claim cleanup when the named container remains after removal', () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-fake-docker-stuck-'));
    roots.push(fakeBin);
    const fakeDocker = path.join(fakeBin, 'docker');
    fs.writeFileSync(fakeDocker, '#!/bin/sh\nif [ "$1" = "rm" ]; then exit 1; fi\nif [ "$1" = "ps" ]; then printf "%s\n" "alex-studio-runner-stuck-test"; exit 0; fi\nexit 2\n', { mode: 0o755 });
    const previousPath = process.env.PATH;
    process.env.PATH = fakeBin;
    try {
      expect(removeAndVerifyContainer('alex-studio-runner-stuck-test')).toMatchObject({ verified: false });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});

describe('isolated npm runner preflight', () => {
  it('requires the trusted Playwright image to be pinned by a SHA-256 digest', () => {
    expect(isPinnedRunnerImage('mcr.microsoft.com/playwright:v1.56.1-noble@sha256:42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2')).toBe(true);
    expect(isPinnedRunnerImage('mcr.microsoft.com/playwright:v1.56.1-noble@sha256:' + 'a'.repeat(64))).toBe(false);
    expect(isPinnedRunnerImage('mcr.microsoft.com/playwright:v1.57.0-noble@sha256:' + 'a'.repeat(64))).toBe(false);
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
    process.env.AI_RUNNER_DOCKER_IMAGE = 'mcr.microsoft.com/playwright:v1.56.1-noble@sha256:42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2';
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

  it('classifies a Docker daemon connection failure as UNAVAILABLE', async () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({
      name: 'demo', version: '1.0.0', scripts: { build: 'node build.js', test: 'node test.js' },
    }));
    write(root, 'package-lock.json', JSON.stringify({
      name: 'demo', version: '1.0.0', lockfileVersion: 3,
      packages: { '': { name: 'demo', version: '1.0.0' } },
    }));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-cache-daemon-test-'));
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-fake-docker-'));
    roots.push(cache, fakeBin);
    const fakeDocker = path.join(fakeBin, 'docker');
    fs.writeFileSync(fakeDocker, '#!/bin/sh\necho "Cannot connect to the Docker daemon" >&2\nexit 125\n', { mode: 0o755 });
    const previousCache = process.env.AI_RUNNER_NPM_CACHE;
    const previousImage = process.env.AI_RUNNER_DOCKER_IMAGE;
    const previousPath = process.env.PATH;
    process.env.AI_RUNNER_NPM_CACHE = cache;
    process.env.AI_RUNNER_DOCKER_IMAGE = 'mcr.microsoft.com/playwright:v1.56.1-noble@sha256:42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2';
    process.env.PATH = fakeBin;
    try {
      const result = await runProjectCommands(root);
      expect(result).toMatchObject({
        ok: false, available: false, status: 'UNAVAILABLE',
        summary: 'Container cleanup could not be verified; runner result is not trusted.',
        cleanupVerified: false,
      });
      expect(result.commands.every(command => command.status === 'UNAVAILABLE')).toBe(true);
      expect(result.output).toContain('Cannot connect to the Docker daemon');
    } finally {
      if (previousCache === undefined) delete process.env.AI_RUNNER_NPM_CACHE;
      else process.env.AI_RUNNER_NPM_CACHE = previousCache;
      if (previousImage === undefined) delete process.env.AI_RUNNER_DOCKER_IMAGE;
      else process.env.AI_RUNNER_DOCKER_IMAGE = previousImage;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

});