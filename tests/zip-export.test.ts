import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createProjectZip } from '../lib/zip-export';

function readZipEntries(zip: Buffer) {
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zip.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, inflateRawSync(compressed).toString('utf8'));
    offset = dataStart + compressedSize;
  }
  return entries;
}

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

  it('excludes common secret-bearing filenames and directories at any depth', () => {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'safe');
    fs.writeFileSync(path.join(root, 'credentials.json'), 'credential-secret');
    fs.writeFileSync(path.join(root, 'id_rsa'), 'private-key');
    fs.writeFileSync(path.join(root, 'config', 'secrets.txt'), 'secret-value');
    fs.writeFileSync(path.join(root, 'secrets', 'config.json'), 'nested-secret');
    const entries = readZipEntries(createProjectZip(root));
    expect(entries.get('index.html')).toBe('safe');
    for (const excludedPath of ['credentials.json', 'id_rsa', 'config/secrets.txt', 'secrets/config.json']) {
      expect(entries.has(excludedPath)).toBe(false);
    }
    for (const excludedContent of ['credential-secret', 'private-key', 'secret-value', 'nested-secret']) {
      expect(Array.from(entries.values()).some((content) => content.includes(excludedContent))).toBe(false);
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
