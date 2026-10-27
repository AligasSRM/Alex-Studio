import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectZip } from '../lib/zip-export';

describe('project ZIP export', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-zip-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('creates a valid ZIP container with project files and nested paths', () => {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>Hello</h1>');
    fs.writeFileSync(path.join(root, 'assets', 'site.css'), 'body { color: black; }');
    const zip = createProjectZip(root);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.includes(Buffer.from('index.html'))).toBe(true);
    expect(zip.includes(Buffer.from('assets/site.css'))).toBe(true);
  });

  it('excludes hidden metadata, environment files, backups, dependencies, and Git data', () => {
    fs.mkdirSync(path.join(root, '.alex', 'backups'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'node_modules', 'sample'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'safe');
    fs.writeFileSync(path.join(root, '.env'), 'secret');
    fs.writeFileSync(path.join(root, '.alex', 'backups', 'old.bak'), 'private');
    fs.writeFileSync(path.join(root, '.git', 'config'), 'git config');
    fs.writeFileSync(path.join(root, 'node_modules', 'sample', 'index.js'), 'dependency');
    const zip = createProjectZip(root);
    expect(zip.includes(Buffer.from('index.html'))).toBe(true);
    for (const excluded of ['.env', '.alex', 'old.bak', '.git', 'config', 'node_modules', 'index.js']) {
      expect(zip.includes(Buffer.from(excluded))).toBe(false);
    }
  });

  it('rejects a symlink as the project root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-outside-'));
    const link = path.join(root, 'linked-project');
    try {
      fs.symlinkSync(outside, link, 'dir');
      expect(() => createProjectZip(link)).toThrow('real directory');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
