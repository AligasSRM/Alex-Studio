import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeProjectFile } from '../lib/files';

describe('backup directory security', () => {
  const project = path.join(process.cwd(), 'workspace', 'backup-security-test');

  beforeEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'index.txt'), 'original content');
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('rejects a symlink at the .alex metadata directory', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-backup-outside-'));
    try {
      fs.symlinkSync(outside, path.join(project, '.alex'), 'dir');

      expect(() => writeProjectFile('backup-security-test', 'index.txt', 'changed content')).toThrow(
        'Backup path must contain only real directories'
      );
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlink at the backups directory', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-backup-outside-'));
    try {
      fs.mkdirSync(path.join(project, '.alex'));
      fs.symlinkSync(outside, path.join(project, '.alex', 'backups'), 'dir');

      expect(() => writeProjectFile('backup-security-test', 'index.txt', 'changed content')).toThrow(
        'Backup path must contain only real directories'
      );
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('creates a regular backup directory and preserves the previous file', () => {
    expect(writeProjectFile('backup-security-test', 'index.txt', 'updated content')).toEqual({ backup: true });

    const backupDirectory = path.join(project, '.alex', 'backups');
    const backupEntries = fs.readdirSync(backupDirectory);
    expect(backupEntries).toHaveLength(1);
    expect(fs.lstatSync(backupDirectory).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(backupDirectory, backupEntries[0]), 'utf8')).toBe('original content');
    expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('updated content');
  });
});
