import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a workspace-relative path and reject both lexical traversal and
 * existing symlink paths that resolve outside the workspace.
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

  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  if (!isWithinRoot(resolved, WORKSPACE_ROOT)) {
    throw new Error("Path is outside workspace");
  }

  // Ensure the workspace root itself is not redirected by a symlink.
  if (fs.existsSync(WORKSPACE_ROOT)) {
    const realRoot = fs.realpathSync(WORKSPACE_ROOT);
    if (!isWithinRoot(resolved, realRoot) && !isWithinRoot(resolved, WORKSPACE_ROOT)) {
      throw new Error("Path is outside workspace");
    }
  }

  // If the target or an ancestor already exists, check its real path too.
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (fs.existsSync(existing)) {
    const realRoot = fs.existsSync(WORKSPACE_ROOT)
      ? fs.realpathSync(WORKSPACE_ROOT)
      : WORKSPACE_ROOT;
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

  // Revalidate after directory creation to catch symlinked ancestors.
  validatePath(relativePath);
  const tmpPath = path.join(dir, `.${path.basename(fullPath)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf-8", flag: "wx", mode: 0o600 });
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

  const backupDir = path.join(WORKSPACE_ROOT, ".alex", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${Date.now()}-${randomUUID()}.bak`);
  fs.copyFileSync(fullPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
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
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const realRoot = fs.realpathSync(WORKSPACE_ROOT);
  if (!isWithinRoot(realRoot, path.resolve(process.cwd()))) {
    throw new Error("Workspace root resolves outside the application directory");
  }
}
