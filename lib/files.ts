import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, resolveProjectPath, assertTextContent } from './path-security';

export type FileNode = { name: string; path: string; type: 'file' | 'folder'; size?: number };

function ensureRealDirectory(parent: string, name: string): string {
  const target = path.join(parent, name);

  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Backup path must contain only real directories');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      fs.mkdirSync(target, { mode: 0o700 });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Backup path must contain only real directories');
    }
  }

  return target;
}

function ensureBackupDirectory(id: string): string {
  const root = projectRoot(id);
  const metadataDirectory = ensureRealDirectory(root, '.alex');
  return ensureRealDirectory(metadataDirectory, 'backups');
}

export function listProjectFiles(id: string): FileNode[] {
  const root = projectRoot(id);
  if (!fs.existsSync(root)) return [];
  const out: FileNode[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 8) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (entry.isDirectory()) {
        out.push({ name: entry.name, path: relative, type: 'folder' });
        walk(file, depth + 1);
      } else if (entry.isFile()) {
        const size = fs.statSync(file).size;
        if (size <= 1048576) out.push({ name: entry.name, path: relative, type: 'file', size });
      }
    }
  }

  walk(root, 0);
  return out;
}

export function readProjectFile(id: string, projectPath: string) {
  const file = resolveProjectPath(id, projectPath);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1048576) throw new Error('Unsupported text file');
  const content = fs.readFileSync(file, 'utf8');
  assertTextContent(content);
  return content;
}

export function writeProjectFile(id: string, projectPath: string, content: unknown) {
  assertTextContent(content);
  const file = resolveProjectPath(id, projectPath);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  resolveProjectPath(id, projectPath);

  const existed = fs.existsSync(file);
  if (existed && (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) {
    throw new Error('Target must be a regular file');
  }

  if (existed) {
    const backupDirectory = ensureBackupDirectory(id);
    const backupName = path.basename(projectPath) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.bak';
    fs.copyFileSync(file, path.join(backupDirectory, backupName), fs.constants.COPYFILE_EXCL);
  }

  const temporaryFile = path.join(directory, '.alex-tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  fs.writeFileSync(temporaryFile, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temporaryFile, file);
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true });
    throw error;
  }

  return { backup: existed };
}
