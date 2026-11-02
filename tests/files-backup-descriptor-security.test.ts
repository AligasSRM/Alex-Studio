import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteProjectFile, readProjectFile, writeProjectFile } from '../lib/files';

describe('Windows-compatible project file operations', () => {
  const projectId = 'windows-file-ops-test';
  const project = path.join(process.cwd(), 'workspace', projectId);

  beforeEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'index.txt'), 'original content');
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('reads and atomically replaces a file while preserving a backup', () => {
    expect(readProjectFile(projectId, 'index.txt')).toBe('original content');
    expect(writeProjectFile(projectId, 'index.txt', 'updated content')).toEqual({ backup: true });
    expect(readProjectFile(projectId, 'index.txt')).toBe('updated content');
    const backups = path.join(project, '.alex', 'backups');
    const entries = fs.readdirSync(backups);
    expect(entries).toHaveLength(1);
    expect(fs.readFileSync(path.join(backups, entries[0]), 'utf8')).toBe('original content');
  });

  it('creates missing nested directories and new files', () => {
    expect(writeProjectFile(projectId, 'src/nested/new.txt', 'hello', null)).toEqual({ backup: false });
    expect(readProjectFile(projectId, 'src/nested/new.txt')).toBe('hello');
  });

  it('refuses stale expected content without changing the file', () => {
    expect(() => writeProjectFile(projectId, 'index.txt', 'changed', 'stale content')).toThrow(/changed during the operation/);
    expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
  });

  it('refuses traversal and hidden paths', () => {
    expect(() => readProjectFile(projectId, '../outside.txt')).toThrow();
    expect(() => writeProjectFile(projectId, '.secret', 'no')).toThrow();
  });

  it('rejects a symlink/junction in a target parent when the OS permits creating one', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-outside-'));
    try {
      try {
        fs.symlinkSync(outside, path.join(project, 'linked'), 'junction');
      } catch {
        // Some Windows environments deny symlink creation; this test records that prerequisite limitation.
        return;
      }
      expect(() => writeProjectFile(projectId, 'linked/escape.txt', 'blocked', null)).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('deletes only when the reviewed content matches', () => {
    expect(() => deleteProjectFile(projectId, 'index.txt', 'not current')).toThrow(/changed during the operation/);
    expect(fs.existsSync(path.join(project, 'index.txt'))).toBe(true);
    deleteProjectFile(projectId, 'index.txt', 'original content');
    expect(fs.existsSync(path.join(project, 'index.txt'))).toBe(false);
  });
});
