import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertLocalMutation, projectRoot, resolveProjectPath } from '../lib/path-security';

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
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects NUL bytes and oversized content', () => {\n    const { assertTextContent } = require('../lib/path-security');\n    expect(() => assertTextContent('bad\\0text')).toThrow();\n    expect(() => assertTextContent('x'.repeat(1024 * 1024 + 1))).toThrow();\n  });\n\n  it('rejects missing origin headers', () => {
    expect(assertLocalMutation(new Request('http://localhost:3000/api/files', { method: 'POST' }))).toBe(false);
  });

  it('allows same-origin localhost mutations', () => {
    expect(assertLocalMutation(new Request('http://localhost:3000/api/files', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' }
    }))).toBe(true);
  });

  it('rejects non-local hosts', () => {
    expect(assertLocalMutation(new Request('https://example.com/api/files', {
      method: 'POST',
      headers: { origin: 'https://example.com', host: 'example.com' }
    }))).toBe(false);
  });
});
