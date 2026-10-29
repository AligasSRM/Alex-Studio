import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { projectRoot } from './path-security';

export type BatchManifest = {
  batchId: string;
  timestamp: string;
  status: 'prepared' | 'applied' | 'rollback-in-progress' | 'rolled-back' | 'apply-failed';
  paths: string[];
  beforeContents: (string | null)[];
  beforeHashes: (string | null)[];
  afterHashes: string[];
  rollbackTimestamp?: string;
};

function directory(projectId: string) {
  const root = projectRoot(projectId);
  const alex = path.join(root, '.alex');
  try {
    const stat = fs.lstatSync(alex);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Batch metadata directory must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(alex, { recursive: false, mode: 0o700 });
  }
  const batches = path.join(alex, 'batches');
  try {
    const stat = fs.lstatSync(batches);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Batch manifest directory must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(batches, { recursive: false, mode: 0o700 });
  }
  fs.chmodSync(batches, 0o700);
  return batches;
}

function fileFor(projectId: string, batchId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(batchId)) throw new Error('Invalid batch id');
  return path.join(directory(projectId), batchId + '.json');
}

export function writeBatchManifest(projectId: string, manifest: BatchManifest) {
  const file = fileFor(projectId, manifest.batchId);
  const temp = file + '.tmp-' + randomUUID();
  fs.writeFileSync(temp, JSON.stringify(manifest), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temp, file); } catch (error) { fs.rmSync(temp, { force: true }); throw error; }
  fs.chmodSync(file, 0o600);
}

export function readBatchManifest(projectId: string, batchId: string): BatchManifest {
  const file = fileFor(projectId, batchId);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Batch manifest must be a regular file');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as BatchManifest;
  if (value.batchId !== batchId || !Array.isArray(value.paths) || value.paths.length < 1 ||
      value.paths.length > 10 || value.beforeContents.length !== value.paths.length ||
      value.beforeHashes.length !== value.paths.length || value.afterHashes.length !== value.paths.length) {
    throw new Error('Invalid batch manifest');
  }
  return value;
}

export function listBatchManifests(projectId: string) {
  const dir = directory(projectId);
  return fs.readdirSync(dir).filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name))
    .map((name) => {
      try {
        const id = name.slice(0, -5);
        const manifest = readBatchManifest(projectId, id);
        return {
          batchId: manifest.batchId,
          timestamp: manifest.timestamp,
          status: manifest.status,
          paths: manifest.paths,
          beforeHashes: manifest.beforeHashes,
          afterHashes: manifest.afterHashes,
          rollbackTimestamp: manifest.rollbackTimestamp,
        };
      } catch { return null; }
    }).filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100);
}
