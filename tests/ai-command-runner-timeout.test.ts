import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const mockSpawn = jest.fn();
const mockSpawnSync = jest.fn();

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: (...args: unknown[]) => mockSpawn(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import { runProjectCommands } from '../lib/ai-command-runner';

describe('isolated npm runner timeout cleanup ordering', () => {
  const roots: string[] = [];
  const originalCache = process.env.AI_RUNNER_NPM_CACHE;
  const originalImage = process.env.AI_RUNNER_DOCKER_IMAGE;

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    if (originalCache === undefined) delete process.env.AI_RUNNER_NPM_CACHE;
    else process.env.AI_RUNNER_NPM_CACHE = originalCache;
    if (originalImage === undefined) delete process.env.AI_RUNNER_DOCKER_IMAGE;
    else process.env.AI_RUNNER_DOCKER_IMAGE = originalImage;
  });

  function fixture(label: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-' + label + '-'));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-cache-' + label + '-'));
    roots.push(root, cache);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'timeout-fixture', version: '1.0.0',
      scripts: { build: 'node build.js', test: 'node test.js' },
    }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'timeout-fixture', version: '1.0.0', lockfileVersion: 3,
      packages: { '': { name: 'timeout-fixture', version: '1.0.0' } },
    }));
    process.env.AI_RUNNER_NPM_CACHE = cache;
    process.env.AI_RUNNER_DOCKER_IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea';
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(),
    });
    mockSpawn.mockReturnValue(child);
    mockSpawnSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rm') return { status: 0, stdout: 'removed', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });
    return child;
  }

  it('waits for Docker CLI close before verifying cleanup after timeout', async () => {
    jest.useFakeTimers();
    const child = fixture('timeout-close');
    const resultPromise = runProjectCommands(roots[0]);
    expect(mockSpawn).toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(90_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockSpawnSync).not.toHaveBeenCalled();

    child.emit('close', null);
    const result = await resultPromise;
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: false, available: true, status: 'FAIL',
      summary: 'Isolated npm runner timed out', cleanupVerified: true,
    });
  });

  it('fails closed if Docker CLI close is not observed, then retries cleanup on late close', async () => {
    jest.useFakeTimers();
    const child = fixture('timeout-no-close');
    const resultPromise = runProjectCommands(roots[0]);

    await jest.advanceTimersByTimeAsync(95_000);
    const result = await resultPromise;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: false, available: false, status: 'UNAVAILABLE',
      summary: 'Runner timed out and cleanup is unverified', cleanupVerified: false,
    });
    expect(result.output).toContain('Docker CLI close was not observed');
    expect(result.output).not.toContain('container absence verified: true');

    // Once the creator process is observed closed, perform a second cleanup pass.
    child.emit('close', null);
    expect(mockSpawnSync).toHaveBeenCalledTimes(4);
  });
});
