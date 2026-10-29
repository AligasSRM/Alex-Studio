import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const mockSpawn = jest.fn();
const mockSpawnSync = jest.fn();

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: (...args: unknown[]) => mockSpawn(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import { runSandbox } from '../app/api/ai/iterate/route';

describe('AI iterate sandbox timeout cleanup ordering', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('waits for the Docker CLI close event before removing and inspecting the container', async () => {
    jest.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(),
    });
    mockSpawn.mockReturnValue(child);
    mockSpawnSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'ps') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: 'removed', stderr: '' };
    });

    const resultPromise = runSandbox(process.cwd());
    await jest.advanceTimersByTimeAsync(20_000);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockSpawnSync).not.toHaveBeenCalled();

    child.emit('close', null);
    const result = await resultPromise;

    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('timed out');
    expect(result.output).toContain('container absence verified: true');
  });
});
