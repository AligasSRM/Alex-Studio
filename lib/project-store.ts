import fs from 'node:fs';
import path from 'node:path';
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
  const name = input.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error('Name must be 1–80 printable characters');
  const base = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  ensureWorkspaceRoot();
  let id = base;
  let n = 1;
  while (fs.existsSync(path.join(WORKSPACE_ROOT, id))) {
    n++;
    id = base + '-' + n;
  }
  const root = projectRoot(id);
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  const record = { id, name, createdAt: new Date().toISOString() };
  fs.writeFileSync(meta(id), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const safeName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + safeName + '</title><link rel="stylesheet" href="styles.css"></head><body><main><p>YOUR NEW PROJECT</p><h1>' + safeName + '</h1><p>Edit, review, and preview your project.</p><button id="hello">Try interaction</button><p id="message" aria-live="polite"></p></main><script src="script.js"></script></body></html>\n';
  fs.writeFileSync(path.join(root, 'index.html'), html, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(root, 'styles.css'), 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101827;color:#e8eef8;font:16px system-ui;padding:24px}main{max-width:680px;padding:40px;border:1px solid #2b3b52;border-radius:24px;background:#172337}button{background:#76e2c0;border:0;border-radius:10px;padding:12px 18px}\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(root, 'script.js'), "document.querySelector('#hello')?.addEventListener('click',()=>{const n=document.querySelector('#message');if(n)n.textContent='Your project is running.'});\n", { flag: 'wx', mode: 0o600 });
  return record;
}
