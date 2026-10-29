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
    const entries = readZipEntries(zip);
    expect(entries.get('index.html')).toBe('<h1>Hello</h1>');
    expect(entries.get('assets/site.css')).toBe('body { color: black; }');
  });

  it('excludes hidden metadata, backups, dependencies, and Git data', () => {
    fs.mkdirSync(path.join(root, '.alex', 'backups'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'node_modules', 'sample'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'safe');
    fs.writeFileSync(path.join(root, '.env'), 'environment-secret');
    fs.writeFileSync(path.join(root, '.alex', 'backups', 'old.bak'), 'private-backup');
    fs.writeFileSync(path.join(root, '.git', 'config'), 'git-config');
    fs.writeFileSync(path.join(root, 'node_modules', 'sample', 'index.js'), 'dependency');
    const entries = readZipEntries(createProjectZip(root));
    expect(entries.get('index.html')).toBe('safe');
    for (const excluded of ['.env', '.alex/backups/old.bak', '.git/config', 'node_modules/sample/index.js']) {
      expect(entries.has(excluded)).toBe(false);
    }
  });

  it('excludes common secret-bearing filenames and directories at every depth without leaking contents', () => {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'nested', 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'safe-project-content');
    const sensitiveFiles: Record<string, string> = {
      'credentials.json': 'credential-secret-one',
      'credentials_backup.json': 'credential-secret-two',
      'secret.txt': 'secret-content-one',
      'my-api-key.json': 'secret-content-two',
      'id_rsa': 'private-key-one',
      'service.pem': 'private-key-two',
      'config/.env.production': 'environment-secret',
      'config/private_key.pem': 'private-key-three',
      'config/.npmrc': 'registry-token',
      'nested/secrets/config.json': 'nested-secret-content',
    };
    for (const [relativePath, content] of Object.entries(sensitiveFiles)) {
      fs.writeFileSync(path.join(root, relativePath), content);
    }
    const entries = readZipEntries(createProjectZip(root));
    expect(entries.get('index.html')).toBe('safe-project-content');
    for (const relativePath of Object.keys(sensitiveFiles)) {
      expect(entries.has(relativePath)).toBe(false);
    }
    for (const sensitiveContent of Object.values(sensitiveFiles)) {
      expect(Array.from(entries.values()).some((content) => content.includes(sensitiveContent))).toBe(false);
    }
  });

  it('does not export files reached through nested symbolic links', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-outside-'));
    fs.writeFileSync(path.join(outside, 'private.txt'), 'outside-private-content');
    fs.mkdirSync(path.join(root, 'nested'));
    try {
      fs.symlinkSync(outside, path.join(root, 'nested', 'external'), 'dir');
      fs.writeFileSync(path.join(root, 'nested', 'normal.txt'), 'inside-content');
      const entries = readZipEntries(createProjectZip(root));
      expect(entries.get('nested/normal.txt')).toBe('inside-content');
      expect(entries.has('nested/external/private.txt')).toBe(false);
      expect(Array.from(entries.values()).some((content) => content.includes('outside-private-content'))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a project exceeding the 50 MiB total uncompressed export limit', () => {
    fs.writeFileSync(path.join(root, 'large.bin'), Buffer.alloc(50 * 1024 * 1024 + 1, 0x61));
    expect(() => createProjectZip(root)).toThrow('50 MiB export limit');
  });

  it('rejects projects containing more than 10,000 files', () => {
    for (let index = 0; index <= 10000; index++) {
      fs.writeFileSync(path.join(root, 'file-' + index + '.txt'), '');
    }
    expect(() => createProjectZip(root)).toThrow('too many files to export');
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
