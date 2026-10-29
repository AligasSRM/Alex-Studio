import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSandbox } from '../app/api/ai/iterate/route';

const enabled = process.env.RUN_DOCKER_INTEGRATION === '1';

(enabled ? describe : describe.skip)('AI iterate browser sandbox real-Docker integration', () => {
  it('uses the approved image and verifies container cleanup after the browser smoke test', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-iterate-browser-test-'));
    try {
      fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head><title>Sandbox Test</title></head><body><main>Browser runner acceptance</main></body></html>\n', 'utf8');
      const result = await runSandbox(root);
      expect(result).toMatchObject({ ok: true, available: true }); // Failure output is emitted by Jest's received-value diff.
      expect(result.summary).toContain('container cleanup verified');
      expect(result.output).toContain('container absence verified: true');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
