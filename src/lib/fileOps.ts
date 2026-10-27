import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const APP_ROOT = path.resolve(process.cwd());
const WORKSPACE_ROOT = path.join(APP_ROOT, "workspace");

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getRealWorkspaceRoot(): string {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const realRoot = fs.realpathSync(WORKSPACE_ROOT);
  if (!isWithinRoot(realRoot, APP_ROOT)) {
    throw new Error("Workspace root resolves outside the application directory");
  }
  return realRoot;
}

/**
 * Resolve a workspace-relative path and reject lexical traversal and existing
 * symlinks that resolve outside the canonical workspace.
 */
export function validatePath(relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error("Path cannot be empty");
  }
  if (relativePath.includes("\0")) {
    throw new Error("Null bytes are not allowed");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute paths are not allowed");
  }
  if (relativePath.split(/[\\/]+/).some((part) => part === "..")) {
    throw new Error("Path traversal (..) is not allowed");
  }

  const realRoot = getRealWorkspaceRoot();
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  if (!isWithinRoot(resolved, WORKSPACE_ROOT)) {
    throw new Error("Path is outside workspace");
  }

  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (fs.existsSync(existing)) {
    const realExisting = fs.realpathSync(existing);
    if (!isWithinRoot(realExisting, realRoot)) {
      throw new Error("Path resolves outside workspace");
    }
  }

  return resolved;
}

export function readFile(relativePath: string): string {
  const fullPath = validatePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${relativePath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

export function writeFile(relativePath: string, content: string): void {
  const fullPath = validatePath(relativePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });

  // Revalidate after directory creation to detect symlinked ancestors.
  validatePath(relativePath);
  const tmpPath = path.join(dir, `.${path.basename(fullPath)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf-8", flag: "wx", mode: 0o600 });
    // Revalidate immediately before replacement.
    validatePath(relativePath);
    fs.renameSync(tmpPath, fullPath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  }
}

export function createBackup(relativePath: string): string {
  const fullPath = validatePath(relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Cannot backup missing or non-file path: ${relativePath}`);
  }

  const realRoot = getRealWorkspaceRoot();
  const backupDir = path.join(realRoot, ".alex", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const realBackupDir = fs.realpathSync(backupDir);
  if (!isWithinRoot(realBackupDir, realRoot)) {
    throw new Error("Backup directory resolves outside workspace");
  }
  const pathKey = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  const backupPath = path.join(realBackupDir, `${pathKey}-${Date.now()}-${randomUUID()}.bak`);
  fs.copyFileSync(fullPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

export function restoreBackup(relativePath: string, backupId: string): { safetyBackupPath: string | null; sha256: string } {
  validatePath(relativePath);
  if (typeof backupId !== "string" || !/^[a-f0-9]{16}-\\d+-[0-9a-f-]{36}\\.bak$/.test(backupId)) {
    throw new Error("Invalid backup identifier");
  }

  const pathKey = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  if (!backupId.startsWith(`${pathKey}-`)) {
    throw new Error("Backup does not belong to this file");
  }

  const realRoot = getRealWorkspaceRoot();
  const backupDir = path.join(realRoot, ".alex", "backups");
  if (!fs.existsSync(backupDir)) throw new Error("Backup directory not found");
  const realBackupDir = fs.realpathSync(backupDir);
  if (!isWithinRoot(realBackupDir, realRoot)) throw new Error("Backup directory resolves outside workspace");

  const backupPath = path.resolve(realBackupDir, backupId);
  if (!isWithinRoot(backupPath, realBackupDir) || path.basename(backupPath) !== backupId) {
    throw new Error("Invalid backup path");
  }
  if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile() ||
      !isWithinRoot(fs.realpathSync(backupPath), realBackupDir)) {
    throw new Error("Backup file not found");
  }

  const content = fs.readFileSync(backupPath, "utf-8");
  const safetyBackupPath = fileExists(relativePath) ? createBackup(relativePath) : null;
  writeFile(relativePath, content);
  return { safetyBackupPath, sha256: createHash("sha256").update(content).digest("hex") };
}

export function fileExists(relativePath: string): boolean {
  try {
    const fullPath = validatePath(relativePath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

export function ensureWorkspace(): void {
  getRealWorkspaceRoot();
}
