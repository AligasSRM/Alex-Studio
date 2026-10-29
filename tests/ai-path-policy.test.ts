import { isProtectedAIGeneratedPath } from '../lib/ai-path-policy';

describe('AI-generated path policy', () => {
  it.each([
    'package-lock.json',
    'nested/package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'pnpm-lock.yml',
    'bun.lock',
    'bun.lockb',
    '.env.local',
    'src/.git/config',
    'node_modules/pkg/index.js',
  ])('blocks protected generated path %s', (filePath) => {
    expect(isProtectedAIGeneratedPath(filePath)).toBe(true);
  });

  it.each(['index.html', 'src/App.tsx', 'styles/site.css', 'package.json'])(
    'allows ordinary project path %s', (filePath) => {
      expect(isProtectedAIGeneratedPath(filePath)).toBe(false);
    },
  );
});
