import fs from 'fs';
import path from 'path';

export const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace');

export function resolveWorkspacePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid path');
  }

  const resolved = path.resolve(WORKSPACE_ROOT, normalized);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error('Outside workspace');
  }

  return resolved;
}

export function isPathAllowed(fullPath: string): boolean {
  try {
    const realRoot = fs.realpathSync.native(WORKSPACE_ROOT);
    const realTarget = fs.existsSync(fullPath) ? fs.realpathSync.native(fullPath) : fullPath;
    return realTarget.startsWith(realRoot);
  } catch {
    return false;
  }
}
