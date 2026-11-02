import fs from 'node:fs';
import path from 'node:path';
import { ensureWorkspaceRoot, projectRoot, validateProjectId, WORKSPACE_ROOT } from './path-security';
import { WINDOWS_MUTATION_UNAVAILABLE } from './platform-mutation';

export type ProjectRecord = { id: string; name: string; createdAt: string };

function meta(id: string) {
  return path.join(projectRoot(id), '.alex-project.json');
}

function readProjectRecord(id: string): ProjectRecord | null {
  const root = projectRoot(id);
  try {
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    const metadata = meta(id);
    let metadataStat: fs.Stats;
    try {
      metadataStat = fs.lstatSync(metadata);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(metadata, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Partial<ProjectRecord>;
    if (record.id !== id || typeof record.name !== 'string' || typeof record.createdAt !== 'string') return null;
    return record as ProjectRecord;
  } catch {
    return null;
  }
}

export function listProjects(): ProjectRecord[] {
  ensureWorkspaceRoot();
  return fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .flatMap((entry) => {
      try {
        const id = validateProjectId(entry.name);
        const root = projectRoot(id);
        const rootStat = fs.lstatSync(root);
        if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return [];
        const existing = readProjectRecord(id);
        if (existing) return [existing];
        const metadata = meta(id);
        if (fs.existsSync(metadata)) return [];
        return [{ id, name: id, createdAt: rootStat.birthtime.toISOString() }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getProject(id: string): ProjectRecord | null {
  try {
    validateProjectId(id);
    const root = projectRoot(id);
    if (!fs.existsSync(root)) return null;
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    const metadata = meta(id);
    if (fs.existsSync(metadata)) return readProjectRecord(id);
    return { id, name: id, createdAt: rootStat.birthtime.toISOString() };
  } catch {
    return null;
  }
}

export function createProject(_input: string): ProjectRecord {
  throw new Error(WINDOWS_MUTATION_UNAVAILABLE);
}
