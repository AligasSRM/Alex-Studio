import assert from "node:assert/strict";
import test from "node:test";
import { buildZip } from "./src/lib/zip.ts";

test("ZIP builder emits local and end-of-central-directory signatures", () => {
  const archive = buildZip([
    { name: "index.html", data: Buffer.from("<h1>Hello</h1>") },
    { name: "assets/site.css", data: Buffer.from("body { color: black; }") },
  ]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.ok(archive.includes(Buffer.from("index.html")));
  assert.ok(archive.includes(Buffer.from("assets/site.css")));
});

test("ZIP builder rejects traversal, absolute paths, backslashes, and duplicate names", () => {
  assert.throws(() => buildZip([{ name: "../secret.txt", data: Buffer.from("x") }]), /traversal/i);
  assert.throws(() => buildZip([{ name: "/absolute.txt", data: Buffer.from("x") }]), /traversal/i);
  assert.throws(() => buildZip([{ name: "folder\\secret.txt", data: Buffer.from("x") }]), /Invalid ZIP entry/);
  assert.throws(() => buildZip([
    { name: "index.html", data: Buffer.from("a") },
    { name: "index.html", data: Buffer.from("b") },
  ]), /Duplicate ZIP entry/);
});
