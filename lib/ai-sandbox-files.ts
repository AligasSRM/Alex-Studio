import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_PATH = /(^|\/)(\.env[^/]*|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*|node_modules|\.git|\.alex)(\/|$)/i;

/**
 * Materialize only non-sensitive project files into a fresh isolated runner
 * directory. Secret-bearing files with ordinary names are excluded by the
 * caller-provided set; credential/config paths are excluded independently.
 */
export function writeSandboxFiles(
  root: string,
  files: ReadonlyMap<string, string>,
  secretPaths: ReadonlySet<string>,
): void {
  const resolvedRoot = path.resolve(root);
  for (const [filePath, content] of files) {
    if (SENSITIVE_PATH.test(filePath) || secretPaths.has(filePath)) continue;
    const target = path.resolve(resolvedRoot, ...filePath.split('/'));
    const relative = path.relative(resolvedRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Sandbox path escape denied');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'w', mode: 0o644 });
  }
}
