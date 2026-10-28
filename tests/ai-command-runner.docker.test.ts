import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isPinnedRunnerImage, runProjectCommands } from '../lib/ai-command-runner';

/**
 * Opt-in real Docker integration tests.
 *
 * Run on a machine with Docker, a pre-populated trusted npm cache, and a
 * Playwright image pinned by digest:
 *   AI_RUNNER_DOCKER_IMAGE='mcr.microsoft.com/playwright:<tag>@sha256:<digest>' \
 *   AI_RUNNER_NPM_CACHE='/absolute/path/to/trusted-npm-cache' \
 *   RUN_DOCKER_INTEGRATION=1 npx jest tests/ai-command-runner.docker.test.ts --runInBand
 *
 * These tests deliberately do not pull images or populate caches themselves.
 */
const image = process.env.AI_RUNNER_DOCKER_IMAGE;
const cachePath = process.env.AI_RUNNER_NPM_CACHE;
const enabled = process.env.RUN_DOCKER_INTEGRATION === '1'
  && isPinnedRunnerImage(image)
  && !!cachePath
  && path.isAbsolute(cachePath)
  && fs.existsSync(cachePath)
  && fs.statSync(cachePath).isDirectory();

const describeDocker = enabled ? describe : describe.skip;
const roots: string[] = [];
const originalImage = process.env.AI_RUNNER_DOCKER_IMAGE;
const originalCache = process.env.AI_RUNNER_NPM_CACHE;

function createProject(testScript: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-docker-integration-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'alex-docker-integration-fixture',
    version: '1.0.0',
    scripts: { build: 'node -e "process.exit(0)"', test: testScript },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'alex-docker-integration-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'alex-docker-integration-fixture', version: '1.0.0' },
    },
  }, null, 2));
  return root;
}

function runnerContainers(): string[] {
  try {
    return execFileSync('docker', [
      'ps', '-a', '--filter', 'name=alex-studio-runner-', '--format', '{{.Names}}',
    ], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('Docker isolated command runner integration configuration', () => {
  it('skips real Docker integration unless explicitly configured', () => {
    if (!enabled) {
      // The ordinary CI suite remains portable; this test documents why the
      // real integration suite is skipped instead of silently using a tag.
      expect(process.env.RUN_DOCKER_INTEGRATION === '1' && isPinnedRunnerImage(image)).toBe(false);
    } else {
      expect(isPinnedRunnerImage(image)).toBe(true);
    }
  });
});

describeDocker('isolated npm runner with a real Docker daemon', () => {
  beforeAll(() => {
    if (!isPinnedRunnerImage(originalImage) || !originalCache) throw new Error('Docker integration prerequisites are missing');
    process.env.AI_RUNNER_DOCKER_IMAGE = originalImage;
    process.env.AI_RUNNER_NPM_CACHE = originalCache;
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 10000 });
  });

  afterAll(() => {
    if (originalImage === undefined) delete process.env.AI_RUNNER_DOCKER_IMAGE;
    else process.env.AI_RUNNER_DOCKER_IMAGE = originalImage;
    if (originalCache === undefined) delete process.env.AI_RUNNER_NPM_CACHE;
    else process.env.AI_RUNNER_NPM_CACHE = originalCache;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('runs required scripts in a network-isolated container and removes it afterwards', async () => {
    const before = new Set(runnerContainers());
    const root = createProject(
      'node -e "require(\'node:dns\').promises.lookup(\'example.com\').then(() => process.exit(9), () => process.exit(0))"',
    );
    const result = await runProjectCommands(root);
    expect(result.status).toBe('PASS');
    expect(result.commands.map(command => command.name)).toEqual(['build', 'test']);
    expect(result.commands.every(command => command.status === 'PASS')).toBe(true);
    expect(runnerContainers().filter(name => !before.has(name))).toEqual([]);
  }, 120000);

  it('reports a command timeout and removes the container after termination', async () => {
    const before = new Set(runnerContainers());
    const root = createProject('node -e "setTimeout(() => process.exit(0), 40000)"');
    const result = await runProjectCommands(root);
    expect(result.status).toBe('FAIL');
    expect(result.commands.find(command => command.name === 'test')?.terminationReason).toContain('timed out');
    expect(runnerContainers().filter(name => !before.has(name))).toEqual([]);
  }, 120000);
});
