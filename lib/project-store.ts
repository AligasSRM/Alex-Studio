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
  const slug = projectName.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
  const projectId = slug || 'project';
  const projectDir = path.resolve(process.cwd(), 'workspace', projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  return {
    id: projectId,
    name: projectName,
    createdAt: new Date().toISOString(),
  };
}
