import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_SEGMENT = /^(?:credentials?[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*|node_modules|\.git|\.alex)$/i;

/**
 * Materialize only non-sensitive project files into a fresh isolated runner
 * directory. Secret-bearing files with ordinary filenames are excluded by
 * the caller-provided set; credential/config paths are excluded independently.
 */
export function writeSandboxFiles(
  root: string,
  files: ReadonlyMap<string, string>,
  secretPaths: ReadonlySet<string>,
): void {
  const resolvedRoot = path.resolve(root);
  for (const [filePath, content] of files) {
    const segments = filePath.split('/');
    if (!filePath || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('Sandbox path escape denied');
    }
    const target = path.resolve(resolvedRoot, ...segments);
    const relative = path.relative(resolvedRoot, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Sandbox path escape denied');
    }
    if (segments.some((segment) => segment.startsWith('.') || SENSITIVE_SEGMENT.test(segment)) || secretPaths.has(filePath)) {
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'w', mode: 0o644 });
  }
}
