import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeProjectFile } from '../lib/files';

describe('backup directory descriptor security', () => {
  const project = path.join(process.cwd(), 'workspace', 'backup-fd-security-test');

  beforeEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'index.txt'), 'original content');
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('fails closed when Linux procfs directory handles are unavailable', () => {
    if (process.platform === 'linux' && fs.existsSync('/proc/self/fd')) return;
    expect(() => writeProjectFile('backup-fd-security-test', 'index.txt', 'changed content')).toThrow(
      'Secure backup is unavailable'
    );
    expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
  });

  it('rejects a symlink at the .alex metadata directory', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-backup-outside-'));
    try {
      fs.symlinkSync(outside, path.join(project, '.alex'), 'dir');
      expect(() => writeProjectFile('backup-fd-security-test', 'index.txt', 'changed content')).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlink in a nested target parent directory', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-backup-outside-'));
    try {
      fs.symlinkSync(outside, path.join(project, 'nested'), 'dir');
      expect(() => writeProjectFile('backup-fd-security-test', 'nested/index.txt', 'changed content')).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlink at the backups directory', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-backup-outside-'));
    try {
      fs.mkdirSync(path.join(project, '.alex'));
      fs.symlinkSync(outside, path.join(project, '.alex', 'backups'), 'dir');
      expect(() => writeProjectFile('backup-fd-security-test', 'index.txt', 'changed content')).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('creates a backup through a pinned directory handle before replacing the file', () => {
    expect(writeProjectFile('backup-fd-security-test', 'index.txt', 'updated content')).toEqual({ backup: true });
    const backupDirectory = path.join(project, '.alex', 'backups');
    const entries = fs.readdirSync(backupDirectory);
    expect(entries).toHaveLength(1);
    expect(fs.readFileSync(path.join(backupDirectory, entries[0]), 'utf8')).toBe('original content');
    expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('updated content');
  });

  it('does not follow a symlink used as the file being backed up', () => {
    const outside = path.join(os.tmpdir(), 'alex-backup-source-' + Date.now());
    fs.writeFileSync(outside, 'outside secret');
    try {
      fs.rmSync(path.join(project, 'index.txt'));
      fs.symlinkSync(outside, path.join(project, 'index.txt'));
      expect(() => writeProjectFile('backup-fd-security-test', 'index.txt', 'changed content')).toThrow();
      expect(fs.readFileSync(outside, 'utf8')).toBe('outside secret');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
