import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertLocalMutation, assertLocalRequest, assertTextContent, projectRoot, resolveProjectPath } from '../lib/path-security';

describe('workspace path security', () => {
  const project = path.join(process.cwd(), 'workspace', 'test-project');

  beforeEach(() => fs.mkdirSync(project, { recursive: true }));
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  it('resolves a safe project-relative path', () => {
    expect(resolveProjectPath('test-project', 'src/index.html')).toBe(path.join(project, 'src', 'index.html'));
  });

  it.each(['../outside.txt', 'src/../../outside.txt', '/etc/passwd', 'C:\\Windows\\win.ini', '.alex/backups/secret.bak', 'src//bad.txt'])(
    'rejects unsafe path %s', (value) => expect(() => resolveProjectPath('test-project', value)).toThrow()
  );

  it('rejects invalid project identifiers', () => {
    expect(() => projectRoot('../escape')).toThrow();
    expect(() => projectRoot('.hidden')).toThrow();
  });

  it('rejects a symlink escaping the project', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
      fs.symlinkSync(outside, path.join(project, 'escape'), 'dir');
      expect(() => resolveProjectPath('test-project', 'escape/secret.txt')).toThrow();
      fs.symlinkSync(path.join(outside, 'not-created-yet.txt'), path.join(project, 'dangling'), 'file');
      expect(() => resolveProjectPath('test-project', 'dangling/created.txt')).toThrow();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects NUL bytes and oversized content', () => {
    expect(() => assertTextContent('bad' + String.fromCharCode(0) + 'text')).toThrow();
    expect(() => assertTextContent('x'.repeat(1024 * 1024 + 1))).toThrow();
  });

  it('rejects missing origin headers for mutations', () => {
    expect(assertLocalMutation(new Request('http://localhost:3000/api/files', { method: 'POST' }))).toBe(false);
  });

  it('allows same-origin localhost requests', () => {
    expect(assertLocalRequest(new Request('http://localhost:3000/api/files', {
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    }))).toBe(true);
  });

  it('rejects a remote request URL even when the Host header is spoofed as localhost', () => {
    expect(assertLocalRequest(new Request('http://example.com/api/files', {
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    }))).toBe(false);
  });

  it('rejects mismatched host headers and origins', () => {
    expect(assertLocalRequest(new Request('http://localhost:3000/api/files', {
      headers: { host: '127.0.0.1:3000', origin: 'http://localhost:3000' },
    }))).toBe(false);
    expect(assertLocalRequest(new Request('http://localhost:3000/api/files', {
      headers: { host: 'localhost:3000', origin: 'http://127.0.0.1:3000' },
    }))).toBe(false);
  });

  it('rejects non-local hosts', () => {
    expect(assertLocalMutation(new Request('https://example.com/api/files', {
      method: 'POST',
      headers: { origin: 'https://example.com', host: 'example.com' },
    }))).toBe(false);
  });
});
