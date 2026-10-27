import fs from 'fs';
import path from 'path';

export type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
};

export function listProjectFiles(projectId: string): FileNode[] {
  const projectRoot = path.resolve(process.cwd(), 'workspace', projectId);
  if (!fs.existsSync(projectRoot)) return [];

  const entries: FileNode[] = [];
  const stack = [projectRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, item.name);
      const relPath = path.relative(projectRoot, fullPath).split(path.sep).join('/');
      entries.push({
        name: item.name,
        path: relPath,
        type: item.isDirectory() ? 'folder' : 'file'
      });

      if (item.isDirectory() && !item.name.startsWith('.')) {
        stack.push(fullPath);
      }
    }
  }

  return entries;
}
