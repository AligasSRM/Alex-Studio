import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, resolveProjectPath, assertTextContent, WORKSPACE_ROOT } from './path-security';

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
  resolveProjectPath(id, projectPath);
  const pinned = openPinnedProjectParent(id, projectPath);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      `/proc/self/fd/${pinned.parentDescriptor}/${pinned.fileName}`,
      FILE_FLAGS
    );
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1048576) throw new Error('Unsupported text file');
    const content = fs.readFileSync(descriptor, 'utf8');
    assertTextContent(content);
    return content;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    pinned.close();
  }
}

const DIRECTORY_FLAGS = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
const FILE_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;

/** Open a child directory relative to a pinned directory descriptor, optionally creating it. */
function openDirectoryAt(parentDescriptor: number, name: string, create: boolean): number {
  const target = `/proc/self/fd/${parentDescriptor}/${name}`;
  try {
    return fs.openSync(target, DIRECTORY_FLAGS);
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      fs.mkdirSync(target, { mode: 0o700 });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
    }
    // O_NOFOLLOW is applied on the final component after any competing creation.
    return fs.openSync(target, DIRECTORY_FLAGS);
  }
}

type PinnedProjectPath = {
  projectDescriptor: number;
  parentDescriptor: number;
  fileName: string;
  close(): void;
};

/**
 * Resolve and pin the project root and every parent directory. All subsequent
 * reads, backups, temporary writes and renames use these descriptors rather
 * than re-resolving attacker-replaceable path strings.
 */
function openPinnedProjectParent(projectId: string, projectPath: string): PinnedProjectPath {
  projectRoot(projectId); // validate project id and current workspace/project state
  const parts = projectPath.replace(/\\/g, '/').split('/');
  if (parts.length < 1 || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Invalid project path');
  }
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('Secure file writes are unavailable: Linux procfs directory handles are required');
  }

  const workspaceDescriptor = fs.openSync(WORKSPACE_ROOT, DIRECTORY_FLAGS);
  let projectDescriptor: number | undefined;
  let parentDescriptor: number | undefined;
  try {
    projectDescriptor = openDirectoryAt(workspaceDescriptor, projectId, false);
    parentDescriptor = fs.openSync(`/proc/self/fd/${projectDescriptor}/.`, DIRECTORY_FLAGS);
    for (const part of parts.slice(0, -1)) {
      const next = openDirectoryAt(parentDescriptor, part, true);
      fs.closeSync(parentDescriptor);
      parentDescriptor = next;
    }
    return {
      projectDescriptor,
      parentDescriptor,
      fileName: parts[parts.length - 1],
      close() {
        if (parentDescriptor !== undefined) fs.closeSync(parentDescriptor);
        if (projectDescriptor !== undefined) fs.closeSync(projectDescriptor);
      },
    };
  } catch (error) {
    if (parentDescriptor !== undefined) fs.closeSync(parentDescriptor);
    if (projectDescriptor !== undefined) fs.closeSync(projectDescriptor);
    throw error;
  } finally {
    fs.closeSync(workspaceDescriptor);
  }
}

function createBackupThroughPinnedDirectory(projectDescriptor: number, sourceDescriptor: number, backupName: string): void {
  let metadataDescriptor: number | undefined;
  let backupDescriptor: number | undefined;
  let backupFileDescriptor: number | undefined;
  let backupPath: string | undefined;
  try {
    metadataDescriptor = openDirectoryAt(projectDescriptor, '.alex', true);
    backupDescriptor = openDirectoryAt(metadataDescriptor, 'backups', true);
    const sourceStat = fs.fstatSync(sourceDescriptor);
    if (!sourceStat.isFile() || sourceStat.size > 1048576) {
      throw new Error('Backup source must be a regular file no larger than 1 MiB');
    }
    const original = fs.readFileSync(sourceDescriptor);
    backupPath = `/proc/self/fd/${backupDescriptor}/${backupName}`;
    backupFileDescriptor = fs.openSync(
      backupPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600
    );
    fs.writeFileSync(backupFileDescriptor, original);
    fs.fsyncSync(backupFileDescriptor);
  } catch (error) {
    if (backupPath) {
      try { fs.unlinkSync(backupPath); } catch {}
    }
    throw error;
  } finally {
    if (backupFileDescriptor !== undefined) fs.closeSync(backupFileDescriptor);
    if (backupDescriptor !== undefined) fs.closeSync(backupDescriptor);
    if (metadataDescriptor !== undefined) fs.closeSync(metadataDescriptor);
  }
}

function assertExpectedFileState(pinned: PinnedProjectPath, expected: string | null | undefined): void {
  if (expected === undefined) return;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(`/proc/self/fd/${pinned.parentDescriptor}/${pinned.fileName}`, FILE_FLAGS);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1048576) throw new Error('Target must be a regular text file');
    const actual = fs.readFileSync(descriptor, 'utf8');
    if (expected === null || actual !== expected) {
      throw new Error('Project file changed during the operation; refusing to overwrite newer content');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && expected === null) return;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function writeProjectFile(id: string, projectPath: string, content: unknown, expectedCurrentContent?: string | null) {
  assertTextContent(content);
  resolveProjectPath(id, projectPath);
  const pinned = openPinnedProjectParent(id, projectPath);
  let sourceDescriptor: number | undefined;
  let temporaryDescriptor: number | undefined;
  let temporaryPath: string | undefined;
  try {
    assertExpectedFileState(pinned, expectedCurrentContent);
    let existed = false;
    try {
      sourceDescriptor = fs.openSync(
        `/proc/self/fd/${pinned.parentDescriptor}/${pinned.fileName}`,
        FILE_FLAGS
      );
      const stat = fs.fstatSync(sourceDescriptor);
      if (!stat.isFile()) throw new Error('Target must be a regular file');
      if (stat.size > 1048576) throw new Error('Backup source exceeds 1 MiB');
      existed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    if (existed && sourceDescriptor !== undefined) {
      const safeName = pinned.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const backupName = safeName + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.bak';
      createBackupThroughPinnedDirectory(pinned.projectDescriptor, sourceDescriptor, backupName);
    }

    temporaryPath = `/proc/self/fd/${pinned.parentDescriptor}/.alex-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    temporaryDescriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600
    );
    fs.writeFileSync(temporaryDescriptor, content, 'utf8');
    fs.fsyncSync(temporaryDescriptor);
    fs.closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;

    // Rename within the pinned parent directory. A symlink replacement of the
    // path's original parent cannot redirect this operation outside the project.
    // Re-check the caller's expected state immediately before the atomic rename.
    // This narrows the stale-write window; it is not a cross-process compare-and-swap.
    assertExpectedFileState(pinned, expectedCurrentContent);
    fs.renameSync(temporaryPath, `/proc/self/fd/${pinned.parentDescriptor}/${pinned.fileName}`);
    fs.fsyncSync(pinned.parentDescriptor);
    return { backup: existed };
  } catch (error) {
    if (temporaryDescriptor !== undefined) fs.closeSync(temporaryDescriptor);
    if (temporaryPath) {
      try { fs.unlinkSync(temporaryPath); } catch {}
    }
    throw error;
  } finally {
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
    pinned.close();
  }
}

/** Remove a project file through a pinned parent directory after checking its expected bytes. */
export function deleteProjectFile(id: string, projectPath: string, expectedCurrentContent: string) {
  resolveProjectPath(id, projectPath);
  const pinned = openPinnedProjectParent(id, projectPath);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(`/proc/self/fd/${pinned.parentDescriptor}/${pinned.fileName}`, FILE_FLAGS);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1048576) throw new Error('Target must be a regular text file');
    const actual = fs.readFileSync(descriptor, 'utf8');
    if (actual !== expectedCurrentContent) {
      throw new Error('Project file changed during the operation; refusing to delete newer content');
    }
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.unlinkSync(`/proc/self/fd/${pinned.parentDescriptor}/${pinned.fileName}`);
    fs.fsyncSync(pinned.parentDescriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    pinned.close();
  }
}
