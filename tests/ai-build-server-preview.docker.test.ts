import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBuildServerPreview } from '../lib/ai-build-server-preview';

describe('Windows isolated build/server preview gate', () => {
  it('fails closed without starting a generated build or server command', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-windows-preview-gate-'));
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        name: 'preview-gate', version: '1.0.0',
        scripts: { build: 'node build.js', start: 'node server.js' },
      }));
      const result = await runBuildServerPreview(root);
      expect(result).toMatchObject({
        ok: false,
        available: false,
        status: 'UNAVAILABLE',
        cleanupVerified: false,
        pageSnapshot: null,
        url: null,
      });
      expect(result.summary).toContain('Windows-native isolated build/server preview');
      expect(result.output).toContain('No generated command or server was started');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
