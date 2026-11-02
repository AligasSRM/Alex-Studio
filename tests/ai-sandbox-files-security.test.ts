import { filterSandboxFiles } from '../lib/ai-sandbox-files';

describe('sandbox file materialization security', () => {
  it('filters secret-bearing files with ordinary filenames and sensitive config paths', () => {
    const files = new Map<string, string>([
      ['index.html', '<h1>Safe</h1>'],
      ['src/runtime-config.ts', 'const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";'],
      ['config/.env.local', 'API_KEY=not-a-real-key'],
      ['config/credentials.json', '{"token":"not-a-real-token"}'],
      ['src/secret-settings.ts', 'private configuration'],
      ['src/normal.ts', 'export const ok = true;'],
    ]);
    const filtered = filterSandboxFiles(files, new Set(['src/runtime-config.ts']));

    expect(Array.from(filtered.keys())).toEqual(['index.html', 'src/normal.ts']);
    expect(Array.from(filtered.values()).join('\n')).not.toContain('sk-proj-');
  });

  it('does not mutate the original project file map', () => {
    const files = new Map<string, string>([
      ['index.html', '<h1>Safe</h1>'],
      ['src/config.ts', 'secret'],
    ]);
    const filtered = filterSandboxFiles(files, new Set(['src/config.ts']));
    expect(files.size).toBe(2);
    expect(filtered.size).toBe(1);
  });
});
