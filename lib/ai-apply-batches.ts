import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot } from './path-security';

export type AIApplyBatchStatus = 'started' | 'applied' | 'rolling-back' | 'rolled-back' | 'rollback-failed';
export type AIApplyBatchSnapshot = { path: string; beforeContent: string | null; afterContent: string };
export type AIApplyBatchManifest = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  status: AIApplyBatchStatus;
  snapshots: AIApplyBatchSnapshot[];
  rollbackError?: string;
};
export type AIApplyBatchSummary = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  status: AIApplyBatchStatus;
  paths: string[];
  rollbackError?: string;
};

function batchesDirectory(projectId: string) {
  const root = projectRoot(projectId);
  const metadataRoot = path.join(root, '.alex');
  try {
    const stat = fs.lstatSync(metadataRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Project metadata directory must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(metadataRoot, { recursive: false, mode: 0o700 });
  }
  const directory = path.join(metadataRoot, 'ai-apply-batches');
  try {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('AI apply batch directory must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  }
  fs.chmodSync(metadataRoot, 0o700);
  fs.chmodSync(directory, 0o700);
  return directory;
}

function manifestPath(projectId: string, batchId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    throw new Error('Invalid AI apply batch id');
  }
  return path.join(batchesDirectory(projectId), batchId + '.json');
}

function validManifest(value: unknown, batchId: string): value is AIApplyBatchManifest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AIApplyBatchManifest>;
  return item.batchId === batchId &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string' &&
    ['started', 'applied', 'rolling-back', 'rolled-back', 'rollback-failed'].includes(String(item.status)) &&
    Array.isArray(item.snapshots) && item.snapshots.length >= 1 && item.snapshots.length <= 10 &&
    item.snapshots.every((snapshot) => snapshot && typeof snapshot.path === 'string' &&
      (snapshot.beforeContent === null || typeof snapshot.beforeContent === 'string') &&
      typeof snapshot.afterContent === 'string');
}

/** Persist full before/after snapshots in the private .alex metadata directory, never in the ZIP export. */
export function saveAIApplyBatch(projectId: string, manifest: AIApplyBatchManifest) {
  if (!validManifest(manifest, manifest.batchId)) throw new Error('Invalid AI apply batch manifest');
  const destination = manifestPath(projectId, manifest.batchId);
  const temporary = path.join(path.dirname(destination), '.' + randomUUID() + '.tmp');
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0);
  const descriptor = fs.openSync(temporary, flags, 0o600);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('AI apply batch manifest must be a regular file');
    fs.writeFileSync(descriptor, JSON.stringify(manifest) + '\n', 'utf8');
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function readAIApplyBatch(projectId: string, batchId: string): AIApplyBatchManifest | null {
  const file = manifestPath(projectId, batchId);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 5 * 1024 * 1024) {
    throw new Error('Invalid AI apply batch manifest file');
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validManifest(parsed, batchId)) throw new Error('Invalid AI apply batch manifest content');
  return parsed;
}

export function listAIApplyBatches(projectId: string): AIApplyBatchSummary[] {
  const directory = batchesDirectory(projectId);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
    .flatMap((entry) => {
      try {
        const batchId = entry.name.slice(0, -5);
        const manifest = readAIApplyBatch(projectId, batchId);
        if (!manifest) return [];
        return [{
          batchId: manifest.batchId,
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt,
          status: manifest.status,
          paths: manifest.snapshots.map((snapshot) => snapshot.path),
          ...(manifest.rollbackError ? { rollbackError: manifest.rollbackError } : {}),
        }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
}
