describe('workspace path security', () => {
  it('blocks traversal outside workspace', () => {
    const bad = '../../etc/passwd';
    expect(() => require('@/lib/path-security').resolveWorkspacePath(bad)).toThrow();
  });

  it('accepts a valid workspace-relative path', () => {
    const value = require('@/lib/path-security').resolveWorkspacePath('demo/index.html');
    expect(value).toContain('workspace/demo/index.html');
  });
});
