import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProjectCommands } from '../lib/ai-command-runner';

describe('Windows isolated command runner gate', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns UNAVAILABLE without executing generated npm scripts until Windows isolation is implemented', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-windows-runner-gate-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'windows-runner-gate', version: '1.0.0',
      scripts: { build: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' },
    }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'windows-runner-gate', version: '1.0.0', lockfileVersion: 3,
      packages: { '': { name: 'windows-runner-gate', version: '1.0.0' } },
    }));
    const result = await runProjectCommands(root);
    expect(result).toMatchObject({ ok: false, available: false, status: 'UNAVAILABLE' });
    expect(result.summary).toContain('Windows-native isolated execution provider');
    expect(result.commands.every(command => command.startedAt === null && command.exitCode === null)).toBe(true);
  });
});
