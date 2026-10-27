import fs from 'fs';
import path from 'path';

export const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace');

export function ensureWorkspaceRoot() {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
}

export function resolveWorkspacePath(inputPath: string): string {
  ensureWorkspaceRoot();

  const normalized = inputPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid path');
  }

  const resolved = path.resolve(WORKSPACE_ROOT, normalized);
  const workspaceReal = fs.realpathSync.native(WORKSPACE_ROOT);

  if (!resolved.startsWith(workspaceReal)) {
    throw new Error('Path escapes workspace');
  }

  return resolved;
}

export function isPathAllowed(targetPath: string): boolean {
  try {
    const realWorkspace = fs.realpathSync.native(WORKSPACE_ROOT);
    const realTarget = fs.existsSync(targetPath) ? fs.realpathSync.native(targetPath) : targetPath;
    return realTarget.startsWith(realWorkspace);
  } catch {
    return false;
  }
}

export function createProjectDirectory(projectId: string): string {
  ensureWorkspaceRoot();
  const projectDir = path.join(WORKSPACE_ROOT, projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

export function backupFile(filePath: string): string {
  const backupDir = path.join(path.dirname(filePath), '.alex', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(filePath)}-${timestamp}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}
