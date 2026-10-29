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
const requested = process.env.RUN_DOCKER_INTEGRATION === '1';
const image = process.env.AI_RUNNER_DOCKER_IMAGE;
const cachePath = process.env.AI_RUNNER_NPM_CACHE;
const prerequisitesValid = isPinnedRunnerImage(image)
  && !!cachePath
  && path.isAbsolute(cachePath)
  && fs.existsSync(cachePath)
  && fs.statSync(cachePath).isDirectory();

const describeDocker = requested ? describe : describe.skip;
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
  return execFileSync('docker', [
    'ps', '-a', '--filter', 'name=alex-studio-runner-', '--format', '{{.Names}}',
  ], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').filter(Boolean);
}

/**
 * Docker's --rm and a force-remove request can finish just after the Docker
 * client exits. Poll briefly for daemon-side cleanup instead of failing on a
 * transient observation, while still failing if any new runner container
 * remains after the bounded wait.
 */
async function expectNoNewRunnerContainers(before: Set<string>, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let remaining: string[] = [];

  do {
    remaining = runnerContainers().filter(name => !before.has(name));
    if (remaining.length === 0) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);

  expect(remaining).toEqual([]);
}

describe('Docker isolated command runner integration configuration', () => {
  it('requires a pinned image and a real external cache when explicitly enabled', () => {
    if (!requested) return;
    expect(prerequisitesValid).toBe(true);
  });
});

describeDocker('isolated npm runner with a real Docker daemon', () => {
  beforeAll(() => {
    if (!prerequisitesValid || !isPinnedRunnerImage(originalImage) || !originalCache) {
      throw new Error('Docker integration prerequisites are missing: configure a pinned Playwright image and an absolute pre-populated npm cache directory.');
    }
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
      `node -e "require('node:dns').promises.lookup('example.com').then(() => process.exit(9), () => process.exit(0))"`,
    );
    const result = await runProjectCommands(root);
    if (result.status !== 'PASS') {
      throw new Error('Docker runner did not pass: ' + JSON.stringify({ status: result.status, summary: result.summary, output: result.output, commands: result.commands }, null, 2));
    }
    expect(result.commands.map(command => command.name)).toEqual(['build', 'test']);
    expect(result.commands.every(command => command.status === 'PASS')).toBe(true);
    await expectNoNewRunnerContainers(before);
  }, 120000);

  it('reports a command timeout and removes the container after termination', async () => {
    const before = new Set(runnerContainers());
    const root = createProject('node -e "setTimeout(() => process.exit(0), 40000)"');
    const result = await runProjectCommands(root);
    if (result.status === 'UNAVAILABLE') {
      throw new Error('Docker runner was unavailable before timeout test could run: ' + JSON.stringify({ summary: result.summary, output: result.output, commands: result.commands }, null, 2));
    }
    expect(result.status).toBe('FAIL');
    expect(result.commands.find(command => command.name === 'test')?.terminationReason).toContain('timed out');
    await expectNoNewRunnerContainers(before);
  }, 120000);
  it('does not pass host-only environment secrets into generated commands', async () => {
    const key = 'ALEX_STUDIO_HOST_ONLY_SENTINEL';
    const previous = process.env[key];
    process.env[key] = 'must-not-enter-container';
    try {
      const before = new Set(runnerContainers());
      const root = createProject('node -e "process.exit(process.env.ALEX_STUDIO_HOST_ONLY_SENTINEL ? 17 : 0)"');
      const result = await runProjectCommands(root);
      if (result.status !== 'PASS') {
        throw new Error('Environment isolation proof failed: ' + JSON.stringify({ status: result.status, summary: result.summary, output: result.output, commands: result.commands }, null, 2));
      }
      expect(result.commands.find(command => command.name === 'test')?.status).toBe('PASS');
      await expectNoNewRunnerContainers(before);
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }, 120000);

  it('keeps original host project bytes unchanged when generated commands write to their workspace', async () => {
    const before = new Set(runnerContainers());
    const root = createProject("node -e \"require('node:fs').writeFileSync('host-sentinel.txt', 'changed')\"");
    const sentinel = path.join(root, 'host-sentinel.txt');
    fs.writeFileSync(sentinel, 'original-host-bytes', 'utf8');
    const original = fs.readFileSync(sentinel);
    const result = await runProjectCommands(root);
    if (result.status !== 'PASS') {
      throw new Error('Host-write isolation proof failed: ' + JSON.stringify({ status: result.status, summary: result.summary, output: result.output, commands: result.commands }, null, 2));
    }
    expect(fs.readFileSync(sentinel).equals(original)).toBe(true);
    await expectNoNewRunnerContainers(before);
  }, 120000);

});
