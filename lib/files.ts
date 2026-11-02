import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, resolveProjectPath, assertTextContent } from './path-security';

export type FileNode = { name: string; path: string; type: 'file' | 'folder'; size?: number };

function listProjectFiles(id: string): FileNode[] {
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

export { listProjectFiles };

export function readProjectFile(id: string, projectPath: string) {
  const file = resolveProjectPath(id, projectPath);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1048576) throw new Error('Unsupported text file');
    const content = fs.readFileSync(descriptor, 'utf8');
    assertTextContent(content);
    return content;
  } finally {
    fs.closeSync(descriptor);
  }
}

function openRealDirectory(parentDescriptor: number, name: string): number {
  const parentPath = `/proc/self/fd/${parentDescriptor}`;
  const target = path.join(parentPath, name);
  const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;

  try {
    return fs.openSync(target, flags);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      fs.mkdirSync(target, { mode: 0o700 });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
    }
    // Re-open with O_NOFOLLOW. The descriptor pins the directory even if its name is
    // subsequently replaced or renamed by another local process.
    return fs.openSync(target, flags);
  }
}

function createBackupThroughPinnedDirectory(projectId: string, sourceFile: string, backupName: string): void {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('Secure backup is unavailable: Linux procfs directory handles are required');
  }

  const root = projectRoot(projectId);
  const rootDescriptor = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let metadataDescriptor: number | undefined;
  let backupDescriptor: number | undefined;
  let sourceDescriptor: number | undefined;
  let backupFileDescriptor: number | undefined;

  try {
    metadataDescriptor = openRealDirectory(rootDescriptor, '.alex');
    backupDescriptor = openRealDirectory(metadataDescriptor, 'backups');

    // Open the source without following a final-component symlink, then copy from
    // the pinned file descriptor rather than resolving the source path a second time.
    sourceDescriptor = fs.openSync(sourceFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const sourceStat = fs.fstatSync(sourceDescriptor);
    if (!sourceStat.isFile() || sourceStat.size > 1048576) {
      throw new Error('Backup source must be a regular file no larger than 1 MiB');
    }
    const original = fs.readFileSync(sourceDescriptor);

    const backupPath = `/proc/self/fd/${backupDescriptor}/${backupName}`;
    backupFileDescriptor = fs.openSync(
      backupPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600
    );
    fs.writeFileSync(backupFileDescriptor, original);
    fs.fsyncSync(backupFileDescriptor);
  } finally {
    if (backupFileDescriptor !== undefined) fs.closeSync(backupFileDescriptor);
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
    if (backupDescriptor !== undefined) fs.closeSync(backupDescriptor);
    if (metadataDescriptor !== undefined) fs.closeSync(metadataDescriptor);
    fs.closeSync(rootDescriptor);
  }
}

export function writeProjectFile(id: string, projectPath: string, content: unknown) {
  assertTextContent(content);
  const file = resolveProjectPath(id, projectPath);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  resolveProjectPath(id, projectPath);

  let existed = false;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Target must be a regular file');
    existed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (existed) {
    const safeName = path.basename(projectPath).replace(/[^a-zA-Z0-9._-]/g, '_');
    const backupName = safeName + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.bak';
    createBackupThroughPinnedDirectory(id, file, backupName);
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
