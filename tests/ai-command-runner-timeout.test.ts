import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProjectCommands } from '../lib/ai-command-runner';

describe('Windows runner fail-closed behavior', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('never spawns a host command when isolated Windows execution is unavailable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-unavailable-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'timeout-fixture', version: '1.0.0',
      scripts: { build: 'node build.js', test: 'node test.js' },
    }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      name: 'timeout-fixture', version: '1.0.0', lockfileVersion: 3,
      packages: { '': { name: 'timeout-fixture', version: '1.0.0' } },
    }));
    const result = await runProjectCommands(root);
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.commands.every(command => command.startedAt === null && command.exitCode === null)).toBe(true);
  });
});
