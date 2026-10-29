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

  it('waits for the Docker CLI close event before verifying container cleanup after timeout', async () => {
    jest.useFakeTimers();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-timeout-test-'));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-timeout-cache-'));
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

    const resultPromise = runProjectCommands(root);
    expect(mockSpawn).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(90_000);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockSpawnSync).not.toHaveBeenCalled();

    child.emit('close', null);
    const result = await resultPromise;

    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: false,
      available: true,
      status: 'FAIL',
      summary: 'Isolated npm runner timed out',
      cleanupVerified: true,
    });
  });
});
