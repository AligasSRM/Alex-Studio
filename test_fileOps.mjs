import { validatePath, readFile, writeFile, createBackup, fileExists, ensureWorkspace } from "./src/lib/fileOps.ts";

// This won't work with TS imports in mjs, so let's just test the logic manually
console.log("Testing fileOps logic...");

// Test 1: validatePath rejects absolute paths
try {
  validatePath("/etc/passwd");
  console.log("FAIL: absolute path accepted");
} catch (e) {
  console.log("PASS: absolute path rejected -", e.message);
}

// Test 2: validatePath rejects ..
try {
  validatePath("../../../etc/passwd");
  console.log("FAIL: .. path accepted");
} catch (e) {
  console.log("PASS: .. path rejected -", e.message);
}

// Test 3: validatePath rejects workspace/../
try {
  validatePath("workspace/../outside.txt");
  console.log("FAIL: workspace/../ accepted");
} catch (e) {
  console.log("PASS: workspace/../ rejected -", e.message);
}

// Test 4: validatePath accepts valid path
try {
  const result = validatePath("index.html");
  console.log("PASS: valid path accepted -", result);
} catch (e) {
  console.log("FAIL: valid path rejected -", e.message);
}

console.log("Tests complete");
