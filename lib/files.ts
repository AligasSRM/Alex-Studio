import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot, resolveProjectPath, assertTextContent } from './path-security';
import { assertWindowsMutationAvailable } from './platform-mutation';

export type FileNode = { name: string; path: string; type: 'file' | 'folder'; size?: number };
const MAX_TEXT_BYTES = 1024 * 1024;

function assertRegularNonLink(target: string, allowMissing = false): fs.Stats | null {
  try {
    const stat = fs.lstatSync(target);
    // On Windows, Node reports symbolic links and directory junctions as symbolic links.
    // Refuse every reparse-point-like entry rather than following it.
    if (stat.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed in project paths');
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported filesystem entry');
    return stat;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertPathWithinProject(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Invalid project path');
  }
  const realRoot = fs.realpathSync.native(root);
  let probe = root;
  for (const part of relative.split(path.sep)) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid project path');
    probe = path.join(probe, part);
    const stat = assertRegularNonLink(probe, true);
    if (!stat) break;
    if (probe !== target && !stat.isDirectory()) throw new Error('Parent path must be a directory');
  }
  // Resolve the nearest existing ancestor: new nested files may have multiple
  // not-yet-created parent directories during the first containment check.
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('No existing ancestor for project path');
    existing = parent;
  }
  assertRegularNonLink(existing);
  const realExisting = fs.realpathSync.native(existing);
  const resolvedRelative = path.relative(realRoot, realExisting);
  if (resolvedRelative === '..' || resolvedRelative.startsWith('..' + path.sep) || path.isAbsolute(resolvedRelative)) {
    throw new Error('Project path escapes its root');
  }
}

function checkedTarget(id: string, projectPath: string): { root: string; target: string; parent: string; name: string } {
  const root = projectRoot(id);
  const target = resolveProjectPath(id, projectPath);
  assertPathWithinProject(root, target);
  const parent = path.dirname(target);
  const name = path.basename(target);
  return { root, target, parent, name };
}

function ensureParents(root: string, parent: string): void {
  const relative = path.relative(root, parent);
  let current = root;
  for (const part of relative ? relative.split(path.sep) : []) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid parent path');
    current = path.join(current, part);
    const stat = assertRegularNonLink(current, true);
    if (!stat) {
      fs.mkdirSync(current);
      assertRegularNonLink(current);
    } else if (!stat.isDirectory()) {
      throw new Error('Parent path must be a directory');
    }
  }
  assertPathWithinProject(root, parent === root ? path.join(root, '.path-check') : path.join(parent, '.path-check'));
}

function readCheckedFile(target: string): string {
  const stat = assertRegularNonLink(target);
  if (!stat?.isFile() || stat.size > MAX_TEXT_BYTES) throw new Error('Unsupported text file');
  const realPath = fs.realpathSync.native(target);
  const content = fs.readFileSync(realPath, 'utf8');
  assertTextContent(content);
  return content;
}

function listProjectFiles(id: string): FileNode[] {
  const root = projectRoot(id);
  if (!fs.existsSync(root)) return [];
  const out: FileNode[] = [];
  function walk(dir: string, depth: number) {
    if (depth > 8) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      const stat = assertRegularNonLink(file);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (stat?.isDirectory()) {
        out.push({ name: entry.name, path: relative, type: 'folder' });
        walk(file, depth + 1);
      } else if (stat?.isFile() && stat.size <= MAX_TEXT_BYTES) {
        out.push({ name: entry.name, path: relative, type: 'file', size: stat.size });
      }
    }
  }
  walk(root, 0);
  return out;
}

export { listProjectFiles };

export function readProjectFile(id: string, projectPath: string) {
  const { root, target } = checkedTarget(id, projectPath);
  if (!fs.existsSync(root)) throw new Error('Project root does not exist');
  assertPathWithinProject(root, target);
  return readCheckedFile(target);
}

function assertExpectedFileState(target: string, expected: string | null | undefined): void {
  if (expected === undefined) return;
  const stat = assertRegularNonLink(target, true);
  if (!stat) {
    if (expected === null) return;
    throw new Error('Project file changed during the operation; refusing to overwrite newer content');
  }
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) throw new Error('Target must be a regular text file');
  const actual = fs.readFileSync(fs.realpathSync.native(target), 'utf8');
  if (expected === null || actual !== expected) {
    throw new Error('Project file changed during the operation; refusing to overwrite newer content');
  }
}

function createBackup(root: string, target: string, backupName: string): void {
  const metadataDir = path.join(root, '.alex');
  const backupDir = path.join(metadataDir, 'backups');
  for (const dir of [metadataDir, backupDir]) {
    const stat = assertRegularNonLink(dir, true);
    if (!stat) fs.mkdirSync(dir);
    else if (!stat.isDirectory()) throw new Error('Backup path must be a directory');
  }
  const source = readCheckedFile(target);
  const backupPath = path.join(backupDir, backupName);
  const descriptor = fs.openSync(backupPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, source, 'utf8');
    fs.fsyncSync(descriptor);
  } catch (error) {
    try { fs.unlinkSync(backupPath); } catch {}
    throw error;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeProjectFile(id: string, projectPath: string, content: unknown, expectedCurrentContent?: string | null) {
  assertWindowsMutationAvailable();
  assertTextContent(content);
  const { root, target, parent } = checkedTarget(id, projectPath);
  ensureParents(root, parent);
  assertPathWithinProject(root, target);
  assertExpectedFileState(target, expectedCurrentContent);

  const originalStat = assertRegularNonLink(target, true);
  if (originalStat && !originalStat.isFile()) throw new Error('Target must be a regular file');
  if (originalStat && originalStat.size > MAX_TEXT_BYTES) throw new Error('Backup source exceeds 1 MiB');
  const existed = Boolean(originalStat);
  if (existed) {
    const backupName = path.basename(target).replace(/[^a-zA-Z0-9._-]/g, '_') + '-' + Date.now() + '-' + randomUUID() + '.bak';
    createBackup(root, target, backupName);
  }

  const temporaryPath = path.join(parent, '.alex-tmp-' + randomUUID());
  let ownsTemporary = false;
  let renamed = false;
  try {
    const descriptor = fs.openSync(temporaryPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    ownsTemporary = true;
    try {
      fs.writeFileSync(descriptor, content, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    // Re-check immediately before replacement. Windows Node APIs do not expose
    // descriptor-relative rename/open primitives, so this is a narrowed race window,
    // not a cross-process compare-and-swap guarantee.
    assertPathWithinProject(root, target);
    assertExpectedFileState(target, expectedCurrentContent);
    const current = assertRegularNonLink(target, true);
    if (current && !current.isFile()) throw new Error('Target must be a regular file');
    fs.renameSync(temporaryPath, target);
    renamed = true;
    const actual = readCheckedFile(target);
    if (actual !== content) throw new Error('Windows file replacement could not be verified');
    return { backup: existed };
  } catch (error) {
    // Reconcile errors after rename: never claim failure if the exact desired bytes
    // are already on disk; never overwrite an unknown concurrent state to recover.
    if (renamed) {
      try {
        if (readCheckedFile(target) === content) return { backup: existed };
      } catch {}
    }
    throw error;
  } finally {
    if (ownsTemporary && !renamed) {
      try { fs.unlinkSync(temporaryPath); } catch {}
    }
  }
}

export function deleteProjectFile(id: string, projectPath: string, expectedCurrentContent: string) {
  assertWindowsMutationAvailable();
  const { root, target } = checkedTarget(id, projectPath);
  assertPathWithinProject(root, target);
  const actual = readCheckedFile(target);
  if (actual !== expectedCurrentContent) {
    throw new Error('Project file changed during the operation; refusing to delete newer content');
  }
  // Re-check type and containment immediately before unlinking; do not follow links.
  assertPathWithinProject(root, target);
  const stat = assertRegularNonLink(target);
  if (!stat?.isFile()) throw new Error('Target must be a regular file');
  fs.unlinkSync(target);
  if (fs.existsSync(target)) throw new Error('File deletion could not be verified');
}
