import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { projectRoot } from './path-security';
import { createEditHistory, type EditHistory } from './edit-history';

const MAX_HISTORY_ENTRIES = 100;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;

function historyDirectory(projectId: string) {
  const root = projectRoot(projectId);
  const metadata = path.join(root, '.alex');
  try {
    const stat = fs.lstatSync(metadata);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Editor history metadata directory must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(metadata, { recursive: false, mode: 0o700 });
  }
  const directory = path.join(metadata, 'editor-history');
  try {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Editor history directory must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  }
  fs.chmodSync(metadata, 0o700);
  fs.chmodSync(directory, 0o700);
  return directory;
}

function historyPath(projectId: string, filePath: string) {
  const key = createHash('sha256').update(filePath, 'utf8').digest('hex');
  return path.join(historyDirectory(projectId), key + '.json');
}

function validHistory(value: unknown): value is EditHistory {
  if (!value || typeof value !== 'object') return false;
  const history = value as Partial<EditHistory>;
  return typeof history.present === 'string' &&
    Array.isArray(history.past) && history.past.length <= MAX_HISTORY_ENTRIES &&
    history.past.every((item) => typeof item === 'string') &&
    Array.isArray(history.future) && history.future.length <= MAX_HISTORY_ENTRIES &&
    history.future.every((item) => typeof item === 'string');
}

/** Keep editor snapshots private and durable across save/reopen, with a bounded manifest. */
export function saveEditorHistory(projectId: string, filePath: string, history: EditHistory) {
  if (!validHistory(history)) throw new Error('Invalid editor history');
  const serialized = JSON.stringify({ version: 1, filePath, history }) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_HISTORY_BYTES) throw new Error('Editor history exceeds the safe storage limit');
  const destination = historyPath(projectId, filePath);
  const temporary = path.join(path.dirname(destination), '.' + randomUUID() + '.tmp');
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0);
  const descriptor = fs.openSync(temporary, flags, 0o600);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('Editor history must be a regular file');
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function loadEditorHistory(projectId: string, filePath: string, currentContent: string): EditHistory {
  const target = historyPath(projectId, filePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const fresh = createEditHistory(currentContent);
      saveEditorHistory(projectId, filePath, fresh);
      return fresh;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_HISTORY_BYTES) {
    throw new Error('Invalid editor history file');
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      const record = parsed as { version?: unknown; filePath?: unknown; history?: unknown };
      if (record.version === 1 && record.filePath === filePath && validHistory(record.history)) {
        const history = record.history;
        // A history may include unsaved edits; the disk version must still exist in its timeline.
        if ([history.present, ...history.past, ...history.future].includes(currentContent)) return history;
      }
    }
  } catch {
    // Invalid/corrupt history is safely reset to the authoritative saved file.
  }
  const fresh = createEditHistory(currentContent);
  saveEditorHistory(projectId, filePath, fresh);
  return fresh;
}
