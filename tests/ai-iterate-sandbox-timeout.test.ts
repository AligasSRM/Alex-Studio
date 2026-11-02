const mockSpawn = jest.fn();
const mockSpawnSync = jest.fn();

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: (...args: unknown[]) => mockSpawn(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import { runSandbox } from '../app/api/ai/iterate/route';

describe('AI iterate sandbox fail-closed behavior', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns UNAVAILABLE without starting Docker or generated browser code', async () => {
    const result = await runSandbox(process.cwd());

    expect(result).toMatchObject({
      ok: false,
      available: false,
      summary: 'Windows-native isolated browser runner is not implemented',
      pageSnapshot: null,
    });
    expect(result.output).toContain('No generated browser code was started');
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});
