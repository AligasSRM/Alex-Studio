import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureWorkspaceRoot, projectRoot, validateProjectId, WORKSPACE_ROOT } from './path-security';

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

export function createProject(input: string): ProjectRecord {
  ensureWorkspaceRoot();
  const name = typeof input === 'string' ? input.trim() : '';
  if (!name || name.length > 80) throw new Error('Project name must contain 1–80 characters');
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'project';
  const id = validateProjectId(slug + '-' + randomUUID().slice(0, 8));
  const root = projectRoot(id);
  fs.mkdirSync(root, { recursive: false });
  const record: ProjectRecord = { id, name, createdAt: new Date().toISOString() };
  try {
    fs.writeFileSync(meta(id), JSON.stringify(record, null, 2) + '\\n', { flag: 'wx' });
    const safeName = name.replace(/[&<>"]/g, '');
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>\\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + safeName + '</title></head><body><main><h1>' + safeName + '</h1></main></body></html>\\n', { flag: 'wx' });
    fs.writeFileSync(path.join(root, 'styles.css'), 'body { font-family: system-ui, sans-serif; margin: 2rem; }\\n', { flag: 'wx' });
    fs.writeFileSync(path.join(root, 'script.js'), '', { flag: 'wx' });
    return record;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function updateProject(id: string, updates: { name?: string }): ProjectRecord | null {
  const current = getProject(id);
  if (!current) return null;
  const name = updates.name === undefined ? current.name : updates.name.trim();
  if (!name || name.length > 80) throw new Error('Project name must contain 1–80 characters');
  const updated = { ...current, name };
  const metadata = meta(id);
  const temporary = metadata + '.tmp-' + randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(updated, null, 2) + '\\n', { flag: 'wx' });
  fs.renameSync(temporary, metadata);
  return updated;
}

export function deleteProject(id: string): boolean {
  const root = projectRoot(id);
  if (!fs.existsSync(root)) return false;
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Project path is not a real directory');
  fs.rmSync(root, { recursive: true, force: false });
  return !fs.existsSync(root);
}
