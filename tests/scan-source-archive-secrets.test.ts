import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scanner = path.resolve(__dirname, '..', 'scripts', 'scan-source-archive-secrets.mjs');

function makeExtractedDirectory(entries: Array<[string, Buffer]>, root: string) {
  for (const [name, bytes] of entries) {
    const target = path.join(root, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
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
    const extractedDir = path.join(tempDir, 'binary-secret');
    fs.mkdirSync(extractedDir);
    const token = Buffer.from(['AKIA', '12345678', '90ABCDEF'].join(''), 'ascii');
    const binary = Buffer.concat([Buffer.from([0, 1, 2, 0]), token, Buffer.from([0, 255])]);
    makeExtractedDirectory([['assets/payload.bin', binary]], extractedDir);

    const result = spawnSync(process.execPath, [scanner, extractedDir], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('secret-like material detected');
    expect(result.stderr).toContain('assets/payload.bin');
  });

  test('accepts a clean NUL-containing binary entry', () => {
    const extractedDir = path.join(tempDir, 'clean-binary');
    fs.mkdirSync(extractedDir);
    makeExtractedDirectory([['assets/payload.bin', Buffer.from([0, 1, 2, 0, 255, 4])]], extractedDir);

    const result = spawnSync(process.execPath, [scanner, extractedDir], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Source archive content scan passed');
  });
});
