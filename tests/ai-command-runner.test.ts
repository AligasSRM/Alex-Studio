import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectGeneratedProject, runProjectCommands, validateProjectTreeLimits } from '../lib/ai-command-runner';

const roots: string[] = [];
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runner-test-'));
  roots.push(root);
  return root;
}
function write(root: string, name: string, content: string) {
  fs.writeFileSync(path.join(root, name), content, 'utf8');
}
function npmFixture(root: string, scripts: Record<string, string> = { build: 'node build.js', test: 'node test.js' }) {
  write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts }));
  write(root, 'package-lock.json', JSON.stringify({
    name: 'demo', version: '1.0.0', lockfileVersion: 3,
    packages: { '': { name: 'demo', version: '1.0.0' } },
  }));
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Windows-only isolated npm runner preflight', () => {
  it('rejects project trees larger than the staging byte limit before execution', () => {
    const root = workspace();
    const oversized = path.join(root, 'oversized.bin');
    fs.closeSync(fs.openSync(oversized, 'w'));
    fs.truncateSync(oversized, 100 * 1024 * 1024 + 1);
    expect(() => validateProjectTreeLimits(root)).toThrow('100 MiB staging limit');
  });

  it('rejects symbolic links and junction-like links in generated project trees', () => {
    const root = workspace();
    const target = path.join(root, 'target.txt');
    write(root, 'target.txt', 'safe');
    fs.symlinkSync(target, path.join(root, 'linked.txt'));
    expect(() => validateProjectTreeLimits(root)).toThrow('symbolic links or junctions');
  });

  it('does not claim npm checks for a static project', async () => {
    const root = workspace();
    expect(inspectGeneratedProject(root).kind).toBe('static');
    await expect(runProjectCommands(root)).resolves.toMatchObject({
      ok: true, available: true, status: 'PASS', commands: [],
    });
  });

  it('fails closed when an npm project has no lockfile', async () => {
    const root = workspace();
    write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { build: 'node build.js', test: 'node test.js' } }));
    const result = await runProjectCommands(root);
    expect(result.available).toBe(false);
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.output).toContain('package-lock.json is required');
  });

  it('requires build and test scripts and records missing scripts as NOT RUN', async () => {
    const root = workspace();
    npmFixture(root, { lint: 'eslint .' });
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
    write(root, 'package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { build: 'node build.js', test: 'node test.js' } }));
    write(root, 'package-lock.json', JSON.stringify({ lockfileVersion: 1, packages: {} }));
    expect(inspectGeneratedProject(root).preflightError).toContain('lockfileVersion 2 or 3');
  });

  it('returns UNAVAILABLE without starting any generated command until Windows isolation exists', async () => {
    const root = workspace();
    npmFixture(root);
    const result = await runProjectCommands(root);
    expect(result).toMatchObject({
      ok: false,
      available: false,
      status: 'UNAVAILABLE',
      summary: 'Windows-native isolated execution provider is not implemented',
    });
    expect(result.output).toContain('No generated command was started');
    expect(result.commands).toHaveLength(2);
    expect(result.commands.every(command => command.status === 'UNAVAILABLE' && command.startedAt === null)).toBe(true);
  });
});
