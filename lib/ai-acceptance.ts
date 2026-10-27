import path from 'node:path';
import { builtinModules } from 'node:module';

export type AcceptanceStatus = 'pass' | 'fail' | 'unverified';
export type AcceptanceCheck = {
  id: string;
  name: string;
  status: AcceptanceStatus;
  evidence: string;
};
export type AcceptanceReport = {
  status: AcceptanceStatus;
  requirements: { id: string; text: string; status: 'unverified'; evidence: string }[];
  checks: AcceptanceCheck[];
  commands: { command: string; status: 'unverified'; reason: string }[];
};

type ProjectFile = { path: string; content: string };
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, '')]));
const EXTERNAL = /^(?:https?:|mailto:|tel:|data:|blob:|file:|\/\/|#)/i;
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml']);
const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);

function resolveReference(from: string, raw: string, files: Map<string, string>): boolean {
  const value = raw.trim().split(/[?#]/, 1)[0];
  if (!value) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^javascript:/i.test(value)) return true;
  if (EXTERNAL.test(value)) return true;
  if (/^javascript:/i.test(value)) return false;
  const base = value === '/' ? 'index.html' : value.startsWith('/') ? value.slice(1) : path.posix.join(path.posix.dirname(from), value);
  const clean = path.posix.normalize(base);
  if (clean === '..' || clean.startsWith('../') || path.posix.isAbsolute(clean)) return false;
  const candidates = [clean, clean + '.html', clean + '.css', clean + '.js', clean + '.mjs', clean + '.cjs',
    clean + '.ts', clean + '.tsx', clean + '.jsx', clean + '.json',
    ...['index.html', 'index.js', 'index.ts', 'index.tsx'].map((name) => path.posix.join(clean, name))];
  return candidates.some((candidate) => files.has(candidate));
}

function collectReferences(file: ProjectFile): { raw: string; kind: string }[] {
  const refs: { raw: string; kind: string }[] = [];
  const addMatches = (pattern: RegExp, kind: string) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.content)) !== null) {
      const value = match.slice(1).find((part) => typeof part === 'string' && part.length > 0)?.trim();
      if (value) refs.push({ raw: value, kind });
      if (match[0].length === 0) pattern.lastIndex++;
    }
  };

  if (HTML_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase())) {
    addMatches(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/gi, 'HTML src/href');
  }
  if (path.posix.extname(file.path).toLowerCase() === '.css') {
    addMatches(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi, 'CSS url()');
    addMatches(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi, 'CSS @import');
  }
  if (SCRIPT_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase())) {
    addMatches(/\bimport\s*["']([^"']+)["']/g, 'module import');
    addMatches(/\bimport\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g, 'module import');
    addMatches(/\bexport\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g, 'module import');
    addMatches(/\brequire\(\s*["']([^"']+)["']\s*\)/g, 'require()');
    addMatches(/\bimport\(\s*["']([^"']+)["']\s*\)/g, 'dynamic import');
  }
  return refs;
}
export function analyzeGeneratedProject(filesInput: ProjectFile[], requestedRequirements: unknown): AcceptanceReport {
  const files = new Map<string, string>();
  const checks: AcceptanceCheck[] = [];
  for (const file of filesInput) {
    const normalized = file.path.replace(/\\/g, '/');
    const safe = normalized === file.path && !path.posix.isAbsolute(normalized) &&
      normalized !== '..' && !normalized.startsWith('../') &&
      normalized.split('/').every((part) => part && part !== '.' && part !== '..');
    if (!safe) {
      checks.push({ id: 'FILE-PATH', name: 'Canonical relative file paths', status: 'fail', evidence: 'Rejected non-canonical path: ' + file.path });
      continue;
    }
    files.set(normalized, file.content);
  }
  if (!checks.some((item) => item.id === 'FILE-PATH')) {
    checks.push({ id: 'FILE-PATH', name: 'Canonical relative file paths', status: 'pass', evidence: files.size + ' unique file paths inspected.' });
  }

  let packageJson: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; scripts?: Record<string, unknown> } | null = null;
  if (files.has('package.json')) {
    try {
      const parsed = JSON.parse(files.get('package.json')!) as typeof packageJson;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('package.json must be an object');
      packageJson = parsed;
      checks.push({ id: 'PKG-JSON', name: 'package.json syntax', status: 'pass', evidence: 'package.json parsed successfully.' });
    } catch (error) {
      checks.push({ id: 'PKG-JSON', name: 'package.json syntax', status: 'fail', evidence: error instanceof Error ? error.message : 'Invalid JSON' });
    }
  } else {
    checks.push({ id: 'PKG-JSON', name: 'package.json syntax', status: 'unverified', evidence: 'No package.json found; this may be valid for a static project.' });
  }

  const missing: string[] = [];
  const undeclared: string[] = [];
  for (const [filePath, content] of files) {
    for (const ref of collectReferences({ path: filePath, content })) {
      if (ref.raw.toLowerCase().startsWith(['java', 'script:'].join(''))) {
        missing.push(filePath + ' -> unsafe active-content URL');
        continue;
      }
      const reference = ref.raw.trim();
      if (/^(?:https?:|mailto:|tel:|data:|blob:|file:|\/\/|#)/i.test(reference)) continue;
      if (['HTML src/href', 'CSS url()', 'CSS @import'].includes(ref.kind)) {
        if (!resolveReference(filePath, reference, files)) missing.push(filePath + ' -> ' + reference + ' (' + ref.kind + ')');
        continue;
      }
      if (ref.raw.startsWith('@/')) {
        if (!resolveReference('index.html', './' + ref.raw.slice(2), files)) missing.push(filePath + ' -> ' + ref.raw + ' (project alias)');
        continue;
      }
      if (ref.raw.startsWith('.') || ref.raw.startsWith('/')) {
        if (!resolveReference(filePath, reference, files)) missing.push(filePath + ' -> ' + reference + ' (' + ref.kind + ')');
        continue;
      }
      const pkg = reference.startsWith('@') ? reference.split('/').slice(0, 2).join('/') : reference.split('/')[0];
      if (!BUILTINS.has(ref.raw) && !BUILTINS.has(pkg) &&
          !packageJson?.dependencies?.[pkg] && !packageJson?.devDependencies?.[pkg]) {
        undeclared.push(filePath + ' -> ' + pkg);
      }
    }
  }
  checks.push({ id: 'REF-LOCAL', name: 'Local links and relative imports', status: missing.length ? 'fail' : 'pass',
    evidence: missing.length ? missing.slice(0, 50).join('\n') : 'No missing local references found by static scan.' });
  checks.push({ id: 'DEP-DECL', name: 'Imported package declarations', status: undeclared.length ? 'fail' : 'pass',
    evidence: undeclared.length ? undeclared.slice(0, 50).join('\n') : 'No undeclared bare imports found by static scan.' });

  const scripts = packageJson?.scripts || {};
  const commands = ['build', 'test', 'lint', 'typecheck'].filter((name) => typeof scripts[name] === 'string')
    .map((name) => ({ command: 'npm run ' + name, status: 'unverified' as const,
      reason: 'Not executed by the static preflight. Execution requires an explicitly isolated runtime and available project dependencies.' }));
  if (commands.length) {
    checks.push({ id: 'CMD-RUN', name: 'Project-specific commands', status: 'unverified',
      evidence: 'Discovered scripts: ' + commands.map((item) => item.command).join(', ') + '. They are listed but were not executed by this preflight.' });
  } else {
    checks.push({ id: 'CMD-RUN', name: 'Project-specific commands', status: 'unverified',
      evidence: 'No standard build/test/lint/typecheck scripts discovered, or no package.json. No project command was executed.' });
  }

  const rawRequirements = Array.isArray(requestedRequirements) ? requestedRequirements : [];
  const requirements = rawRequirements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 20).map((text, index) => ({ id: 'REQ-' + String(index + 1).padStart(3, '0'), text: text.trim().slice(0, 500),
      status: 'unverified' as const, evidence: 'Requirement recorded from the specification; no requirement-specific automated assertion is mapped yet.' }));
  if (!requirements.length) {
    requirements.push({ id: 'REQ-001', text: 'Specification must be converted into explicit acceptance requirements', status: 'unverified',
      evidence: 'The generator did not supply a usable requirement list.' });
  }

  const statuses = checks.map((check) => check.status);
  const status: AcceptanceStatus = statuses.includes('fail') ? 'fail' : 'unverified';
  return { status, requirements, checks, commands };
}
