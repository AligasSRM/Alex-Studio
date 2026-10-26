import fs from "fs";
import path from "path";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");

export function validatePath(relativePath: string): string {
  // Reject empty paths
  if (!relativePath || relativePath.trim() === "") {
    throw new Error("Path cannot be empty");
  }

  // Reject absolute paths
  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute paths are not allowed");
  }

  // Reject null bytes (injection attack)
  if (relativePath.includes("\0")) {
    throw new Error("Null bytes are not allowed");
  }

  // Reject path traversal
  if (relativePath.includes("..")) {
    throw new Error("Path traversal (..) is not allowed");
  }

  // Normalize and resolve
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);

  // Ensure it's within workspace
  if (!resolved.startsWith(WORKSPACE_ROOT + path.sep) && resolved !== WORKSPACE_ROOT) {
    throw new Error("Path is outside workspace");
  }

  return resolved;
}

export function readFile(relativePath: string): string {
  const fullPath = validatePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory: ${relativePath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

export function writeFile(relativePath: string, content: string): void {
  const fullPath = validatePath(relativePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Atomic write: tmp → rename
  const tmpPath = fullPath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, fullPath);
}

export function createBackup(relativePath: string): string {
  const fullPath = validatePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Cannot backup non-existent file: ${relativePath}`);
  }
  const backupDir = path.join(WORKSPACE_ROOT, ".alex", "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = Date.now();
  const backupPath = path.join(backupDir, `${timestamp}.bak`);
  fs.copyFileSync(fullPath, backupPath);
  return backupPath;
}

export function fileExists(relativePath: string): boolean {
  try {
    const fullPath = validatePath(relativePath);
    return fs.existsSync(fullPath);
  } catch {
    return false;
  }
}

export function ensureWorkspace(): void {
  if (!fs.existsSync(WORKSPACE_ROOT)) {
    fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  }
}
