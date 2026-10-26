import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256Content, sha256File } from "./src/lib/checksum.ts";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

check("sha256Content computes the SHA-256 hex digest of a string", () => {
  assert.equal(sha256Content("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Content(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(
    sha256Content("hello world"),
    createHash("sha256").update("hello world").digest("hex")
  );
});

check("sha256File computes the SHA-256 hex digest of file contents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alex-studio-checksum-"));
  const filePath = path.join(dir, "sample.txt");
  fs.writeFileSync(filePath, "hello world");
  assert.equal(
    sha256File(filePath),
    createHash("sha256").update("hello world").digest("hex")
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\nTests complete: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
