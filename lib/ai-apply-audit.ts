import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './path-security';

export type AIApplyAuditEvent = {
  batchId: string;
  timestamp: string;
  outcome: 'started' | 'applied' | 'failed' | 'rolled-back';
  paths: string[];
  beforeHashes: (string | null)[];
  afterHashes: string[];
  rollbackStatus?: 'not-needed' | 'succeeded' | 'failed';
};

function auditFile(projectId: string) {
  const root = projectRoot(projectId);
  const directory = path.join(root, '.alex');
  try {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('AI apply audit directory must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  }
  return path.join(directory, 'ai-apply-audit.jsonl');
}

/** Append metadata-only audit events. File contents and provider secrets are never recorded. */
export function recordAIApplyAudit(projectId: string, event: AIApplyAuditEvent) {
  if (!event.batchId || !event.timestamp || !Array.isArray(event.paths) ||
      event.paths.length < 1 || event.paths.length > 10 ||
      event.beforeHashes.length !== event.paths.length ||
      event.afterHashes.length !== event.paths.length) {
    throw new Error('Invalid AI apply audit event');
  }
  const file = auditFile(projectId);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const descriptor = fs.openSync(file, fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | noFollow, 0o600);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('AI apply audit ledger must be a regular file');
    fs.fchmodSync(descriptor, 0o600);
    fs.writeSync(descriptor, JSON.stringify(event) + '\n', undefined, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
