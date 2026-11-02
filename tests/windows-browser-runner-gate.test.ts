import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSandbox } from '../app/api/ai/iterate/route';

describe('Windows isolated browser runner gate', () => {
  it('fails closed without starting generated browser code until Windows isolation exists', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-windows-browser-gate-'));
    try {
      fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>test</title>');
      const result = await runSandbox(root);
      expect(result).toMatchObject({ ok: false, available: false, pageSnapshot: null });
      expect(result.summary).toContain('Windows-native isolated browser runner');
      expect(result.output).toContain('No generated browser code was started');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
