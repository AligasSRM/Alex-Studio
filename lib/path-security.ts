import fs from 'node:fs';
import path from 'node:path';

export const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace');
const ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function ensureWorkspaceRoot() {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const stat = fs.lstatSync(WORKSPACE_ROOT);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Workspace root must be a real directory');
  }
}

export function validateProjectId(id: string) {
  if (typeof id !== 'string' || !ID.test(id) || id.includes('..')) {
    throw new Error('Invalid project id');
  }
  return id;
}

export function projectRoot(id: string) {
  ensureWorkspaceRoot();
  const root = path.resolve(WORKSPACE_ROOT, validateProjectId(id));
  const relative = path.relative(WORKSPACE_ROOT, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid project root');
  }
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('Project symlinks are not allowed');
  }
  return root;
}

export function resolveProjectPath(id: string, inputPath: string) {
  const root = projectRoot(id);
  if (typeof inputPath !== 'string') throw new Error('Invalid path');

  const normalized = inputPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Invalid path');
  }

  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Hidden or traversal path denied');
  }

  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(root)) {
    throw new Error('Invalid project path');
  }

  const realRoot = fs.realpathSync.native(root);
  let probe = root;
  for (const part of parts) {
    const candidate = path.join(probe, part);
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error('Symlink paths denied');
      if (candidate !== target && !stat.isDirectory()) throw new Error('Parent path must be a directory');
      probe = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }

  const real = fs.realpathSync.native(probe);
  const resolvedRelative = path.relative(realRoot, real);
  if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) {
    throw new Error('Symlink escape denied');
  }
  return target;
}

export function assertLocalRequest(request: Request) {
  const hostHeader = request.headers.get('host');
  if (!hostHeader) return false;

  try {
    const requestUrl = new URL(request.url);
    if (!['http:', 'https:'].includes(requestUrl.protocol)) return false;
    if (!LOCAL_HOSTS.has(requestUrl.hostname.toLowerCase())) return false;

    const host = new URL(requestUrl.protocol + '//' + hostHeader);
    if (!LOCAL_HOSTS.has(host.hostname.toLowerCase())) return false;
    if (host.host.toLowerCase() !== requestUrl.host.toLowerCase()) return false;

    const origin = request.headers.get('origin');
    if (!origin) return true;

    const source = new URL(origin);
    return source.origin === requestUrl.origin && LOCAL_HOSTS.has(source.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertLocalMutation(request: Request) {
  return Boolean(request.headers.get('origin')) && assertLocalRequest(request);
}

export function assertTextContent(content: unknown): asserts content is string {
  if (typeof content !== 'string') throw new Error('Content must be text');
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) throw new Error('File exceeds 1 MiB');
  if (content.includes('\0')) throw new Error('Binary files not supported');
}
