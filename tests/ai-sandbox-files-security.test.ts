import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSandboxFiles } from '../lib/ai-sandbox-files';

describe('sandbox file materialization security', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-sandbox-files-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('does not copy secret-bearing files with ordinary filenames or sensitive config paths', () => {
    const files = new Map<string, string>([
      ['index.html', '<h1>Safe</h1>'],
      ['src/runtime-config.ts', 'const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";'],
      ['config/.env.local', 'API_KEY=not-a-real-key'],
      ['config/credentials.json', '{"token":"not-a-real-token"}'],
    ]);
    writeSandboxFiles(root, files, new Set(['src/runtime-config.ts']));

    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('<h1>Safe</h1>');
    expect(fs.existsSync(path.join(root, 'src/runtime-config.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'config/.env.local'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'config/credentials.json'))).toBe(false);
  });

  it('rejects paths that escape the isolated sandbox root', () => {
    expect(() => writeSandboxFiles(root, new Map([['../outside.txt', 'nope']]), new Set())).toThrow(/path escape/i);
    expect(fs.existsSync(path.join(path.dirname(root), 'outside.txt'))).toBe(false);
  });
});
