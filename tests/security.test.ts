describe('workspace path security', () => {
  it('blocks traversal outside workspace', () => {
    const { resolveWorkspacePath } = require('@/lib/path-security');
    expect(() => resolveWorkspacePath('../../etc/passwd')).toThrow();
  });

  it('accepts a valid workspace-relative path', () => {
    const { resolveWorkspacePath } = require('@/lib/path-security');
    const value = resolveWorkspacePath('demo/index.html');
    expect(value).toContain('workspace/demo/index.html');
  });
});
