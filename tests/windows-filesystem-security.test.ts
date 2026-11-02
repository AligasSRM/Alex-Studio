import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteProjectFile, readProjectFile, writeProjectFile } from '../lib/files';

describe('Windows filesystem mutation safety gate', () => {
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

  it('permits reading a regular project file', () => {
    expect(readProjectFile(projectId, 'index.txt')).toBe('original content');
  });

  it('fails closed on write until native handle-based protections are implemented', () => {
    expect(() => writeProjectFile(projectId, 'index.txt', 'updated content')).toThrow(/UNAVAILABLE: secure Windows-native handle-based file mutation/);
    expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
  });

  it('fails closed on new nested file creation without creating directories', () => {
    expect(() => writeProjectFile(projectId, 'src/nested/new.txt', 'hello', null)).toThrow(/UNAVAILABLE: secure Windows-native handle-based file mutation/);
    expect(fs.existsSync(path.join(project, 'src'))).toBe(false);
  });

  it('fails closed on deletion and preserves the current file', () => {
    expect(() => deleteProjectFile(projectId, 'index.txt', 'original content')).toThrow(/UNAVAILABLE: secure Windows-native handle-based file mutation/);
    expect(fs.readFileSync(path.join(project, 'index.txt'), 'utf8')).toBe('original content');
  });

  it('refuses traversal and hidden paths when reading', () => {
    expect(() => readProjectFile(projectId, '../outside.txt')).toThrow();
    expect(() => readProjectFile(projectId, '.secret')).toThrow();
  });

  it('rejects a junction in a target parent when the OS permits creating one', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-outside-'));
    try {
      try {
        fs.symlinkSync(outside, path.join(project, 'linked'), 'junction');
      } catch {
        return;
      }
      expect(() => readProjectFile(projectId, 'linked/escape.txt')).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
