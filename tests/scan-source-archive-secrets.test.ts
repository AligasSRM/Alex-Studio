import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scanner = path.resolve(__dirname, '..', 'scripts', 'scan-source-archive-secrets.mjs');

function makeArchive(entries: Array<[string, Buffer]>, archivePath: string) {
  const payload = JSON.stringify(entries.map(([name, bytes]) => [name, bytes.toString('base64')]));
  execFileSync('python3', ['-c', [
    'import base64, json, sys, zipfile',
    'items = json.loads(sys.argv[2])',
    'with zipfile.ZipFile(sys.argv[1], "w", compression=zipfile.ZIP_DEFLATED) as z:',
    '  for name, encoded in items:',
    '    z.writestr(name, base64.b64decode(encoded))',
  ].join('\n'), archivePath, payload]);
}

describe('source archive secret scanner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-secret-scan-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('rejects a secret-like token embedded in a NUL-containing binary entry', () => {
    const archivePath = path.join(tempDir, 'binary-secret.zip');
    const token = Buffer.from(['AKIA', '12345678', '90ABCDEF'].join(''), 'ascii');
    const binary = Buffer.concat([Buffer.from([0, 1, 2, 0]), token, Buffer.from([0, 255])]);
    makeArchive([['assets/payload.bin', binary]], archivePath);

    const result = spawnSync(process.execPath, [scanner, archivePath], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('secret-like material detected');
    expect(result.stderr).toContain('assets/payload.bin');
  });

  test('accepts a clean NUL-containing binary entry', () => {
    const archivePath = path.join(tempDir, 'clean-binary.zip');
    makeArchive([['assets/payload.bin', Buffer.from([0, 1, 2, 0, 255, 4])]], archivePath);

    const result = spawnSync(process.execPath, [scanner, archivePath], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Source archive content scan passed');
  });
});
