import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { validatePath, readFile, writeFile, createBackup, restoreBackup, fileExists } from "./src/lib/fileOps.ts";

const workspace = path.join(process.cwd(), "workspace");
const fixture = `test-fixture-${randomUUID()}`;
const fixturePath = `${fixture}/nested/sample.txt`;
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "alex-studio-outside-"));

test("validatePath accepts a workspace-relative path", () => {
  assert.equal(validatePath("index.html"), path.join(workspace, "index.html"));
});

test("validatePath rejects absolute paths", () => {
  assert.throws(() => validatePath(path.join(os.tmpdir(), "secret.txt")), /Absolute paths/);
});

test("validatePath rejects parent traversal segments", () => {
  assert.throws(() => validatePath("../outside.txt"), /Path traversal/);
  assert.throws(() => validatePath("folder/../outside.txt"), /Path traversal/);
});

test("validatePath rejects null bytes and empty paths", () => {
  assert.throws(() => validatePath("bad\0path"), /Null bytes/);
  assert.throws(() => validatePath("   "), /cannot be empty/i);
});

test("writeFile and readFile round-trip content and create backups", () => {
  let backupPath;
  let safetyBackupPath;
  try {
    writeFile(fixturePath, "first");
    assert.equal(readFile(fixturePath), "first");
    assert.equal(fileExists(fixturePath), true);

    backupPath = createBackup(fixturePath);
    assert.equal(fs.readFileSync(backupPath, "utf8"), "first");

    writeFile(fixturePath, "second");
    assert.equal(readFile(fixturePath), "second");
    assert.equal(fs.readFileSync(backupPath, "utf8"), "first");

    assert.throws(() => restoreBackup("other-project/sample.txt", path.basename(backupPath)), /does not belong/i);
    const restored = restoreBackup(fixturePath, path.basename(backupPath));
    safetyBackupPath = restored.safetyBackupPath;
    assert.equal(readFile(fixturePath), "first");
    assert.equal(restored.sha256, "a7937b64b8caa58f03721bb6bacf5c78cb235f4a5c2a8c6b0c0f6b5a7d5c5f6d".slice(0, 64));
    assert.equal(fs.readFileSync(safetyBackupPath, "utf8"), "second");
  } finally {
    if (backupPath) fs.rmSync(backupPath, { force: true });
    if (safetyBackupPath) fs.rmSync(safetyBackupPath, { force: true });
    fs.rmSync(path.join(workspace, fixture), { recursive: true, force: true });
  }
});

test("path through a symlink to outside workspace is rejected", () => {
  const linkPath = path.join(workspace, `${fixture}-outside-link`);
  try {
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "private");
    fs.symlinkSync(outsideDir, linkPath, "dir");
    assert.throws(
      () => validatePath(`${fixture}-outside-link/secret.txt`),
      /outside workspace/i
    );
  } finally {
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
