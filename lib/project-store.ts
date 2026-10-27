import fs from 'fs';
import path from 'path';

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export function listProjects(): ProjectRecord[] {
  const workspaceRoot = path.resolve(process.cwd(), 'workspace');
  if (!fs.existsSync(workspaceRoot)) return [];

  return fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      name: entry.name,
      createdAt: new Date(fs.statSync(path.join(workspaceRoot, entry.name)).birthtimeMs).toISOString(),
    }));
}

export function createProject(projectName: string): ProjectRecord {
  const id = projectName.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
  const projectDir = path.resolve(process.cwd(), 'workspace', id);
  fs.mkdirSync(projectDir, { recursive: true });
  return { id, name: projectName, createdAt: new Date().toISOString() };
}
