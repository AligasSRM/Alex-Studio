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
  requirements: {
    id: string;
    text: string;
    status: 'unverified';
    evidence: string;
  }[];
  checks: AcceptanceCheck[];
  commands: {
    command: string;
    status: 'unverified';
    reason: string;
  }[];
};

type ProjectFile = { path: string; content: string };
type Reference = { value: string; kind: string };

const SCRIPT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
]);
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml']);
const BUILTINS = new Set(
  builtinModules.flatMap((name) => [name, name.replace(/^node:/, ''), 'node:' + name.replace(/^node:/, '')]),
);
const SAFE_EXTERNAL_SCHEMES = new Set([
  'http', 'https', 'mailto', 'tel', 'data', 'blob', 'file', 'ftp', 'ws', 'wss',
]);

function checkFilePath(filePath: string): { safe: boolean; normalized: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const safe =
    normalized.length > 0 &&
    normalized === filePath &&
    !path.posix.isAbsolute(normalized) &&
    !/^[a-zA-Z]:/.test(normalized) &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  return { safe, normalized };
}

function parsePackageJson(content: string | undefined): {
  value: Record<string, unknown> | null;
  error: string | null;
} {
  if (content === undefined) return { value: null, error: null };
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: 'package.json must contain a JSON object.' };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Invalid JSON.',
    };
  }
}

function stringRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstCapture(match: RegExpMatchArray): string {
  for (let index = 1; index < match.length; index += 1) {
    if (typeof match[index] === 'string' && match[index].length > 0) return match[index].trim();
  }
  return '';
}

function collectReferences(file: ProjectFile): Reference[] {
  const references: Reference[] = [];
  const add = (pattern: RegExp, kind: string) => {
    // Keep this ES5-target-safe: for...of over matchAll() is downlevel-transpiled
    // incorrectly when downlevelIteration is disabled, silently skipping matches.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.content)) !== null) {
      const value = firstCapture(match);
      if (value) references.push({ value, kind });
      // Defensive guard for a future accidentally empty-matching expression.
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    pattern.lastIndex = 0;
  };

  const extension = path.posix.extname(file.path).toLowerCase();

  if (HTML_EXTENSIONS.has(extension)) {
    add(/\b(?:src|href)\s*=\s*"([^"]*)"/gi, 'HTML src/href');
    add(/\b(?:src|href)\s*=\s*'([^']*)'/gi, 'HTML src/href');
    add(/\b(?:src|href)\s*=\s*([^\s"'<>]+)/gi, 'HTML src/href');
    add(/\b(?:action|poster|data)\s*=\s*"([^"]*)"/gi, 'HTML resource attribute');
    add(/\b(?:action|poster|data)\s*=\s*'([^']*)'/gi, 'HTML resource attribute');
  }

  if (extension === '.css') {
    add(/url\(\s*"([^"]*)"\s*\)/gi, 'CSS url()');
    add(/url\(\s*'([^']*)'\s*\)/gi, 'CSS url()');
    add(/url\(\s*([^)'"]+)\s*\)/gi, 'CSS url()');
    add(/@import\s+(?:url\(\s*)?"([^"]+)"/gi, 'CSS @import');
    add(/@import\s+(?:url\(\s*)?'([^']+)'/gi, 'CSS @import');
  }

  if (SCRIPT_EXTENSIONS.has(extension)) {
    add(/\bimport\s*["']([^"']+)["']/g, 'module import');
    add(/\bimport\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g, 'module import');
    add(/\bexport\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g, 'module export');
    add(/\brequire\(\s*["']([^"']+)["']\s*\)/g, 'require()');
    add(/\bimport\(\s*["']([^"']+)["']\s*\)/g, 'dynamic import');
  }

  return references;
}

function resolveLocalReference(
  sourceFile: string,
  rawReference: string,
  files: Map<string, string>,
): { exists: boolean; reason?: string } {
  const value = rawReference.trim();
  if (!value || value.startsWith('#')) return { exists: true };

  // Reject executable URLs before treating any scheme as an external resource.
  if (/^javascript\s*:/i.test(value) || /^vbscript\s*:/i.test(value)) {
    return { exists: false, reason: 'unsafe executable URL' };
  }

  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme) {
    return SAFE_EXTERNAL_SCHEMES.has(scheme)
      ? { exists: true }
      : { exists: false, reason: 'unsupported URL scheme' };
  }
  if (value.startsWith('//')) return { exists: true };

  const pathOnly = value.split(/[?#]/, 1)[0];
  if (!pathOnly) return { exists: true };

  const joined = pathOnly.startsWith('/')
    ? pathOnly.slice(1)
    : path.posix.join(path.posix.dirname(sourceFile), pathOnly);
  const resolved = path.posix.normalize(joined);

  if (
    resolved === '.' ||
    resolved === '..' ||
    resolved.startsWith('../') ||
    path.posix.isAbsolute(resolved)
  ) {
    return { exists: false, reason: 'path escapes project root' };
  }

  const candidates = new Set<string>([
    resolved,
    resolved + '.html',
    resolved + '.htm',
    resolved + '.css',
    resolved + '.js',
    resolved + '.jsx',
    resolved + '.ts',
    resolved + '.tsx',
    resolved + '.mjs',
    resolved + '.cjs',
    resolved + '.json',
    ...['index.html', 'index.htm', 'index.js', 'index.ts', 'index.tsx'].map((name) =>
      path.posix.join(resolved, name),
    ),
  ]);

  return Array.from(candidates).some((candidate) => files.has(candidate))
    ? { exists: true }
    : { exists: false, reason: 'target file not found' };
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function isDeclaredDependency(
  specifier: string,
  dependencies: Record<string, unknown>,
  devDependencies: Record<string, unknown>,
  optionalDependencies: Record<string, unknown>,
  peerDependencies: Record<string, unknown>,
): boolean {
  const name = packageName(specifier);
  return Boolean(
    name &&
      (BUILTINS.has(specifier) ||
        BUILTINS.has(name) ||
        dependencies[name] ||
        devDependencies[name] ||
        optionalDependencies[name] ||
        peerDependencies[name]),
  );
}

export function analyzeGeneratedProject(
  filesInput: ProjectFile[],
  requestedRequirements: unknown,
): AcceptanceReport {
  const files = new Map<string, string>();
  const checks: AcceptanceCheck[] = [];

  for (const file of filesInput) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      checks.push({
        id: 'FILE-PATH',
        name: 'Canonical relative file paths',
        status: 'fail',
        evidence: 'Rejected malformed file entry; each entry must have string path and content.',
      });
      continue;
    }

    const pathResult = checkFilePath(file.path);
    if (!pathResult.safe) {
      checks.push({
        id: 'FILE-PATH',
        name: 'Canonical relative file paths',
        status: 'fail',
        evidence: 'Rejected non-canonical path: ' + file.path,
      });
      continue;
    }

    if (files.has(pathResult.normalized)) {
      checks.push({
        id: 'FILE-PATH',
        name: 'Canonical relative file paths',
        status: 'fail',
        evidence: 'Duplicate project path: ' + pathResult.normalized,
      });
      continue;
    }
    files.set(pathResult.normalized, file.content);
  }

  if (!checks.some((check) => check.id === 'FILE-PATH')) {
    checks.push({
      id: 'FILE-PATH',
      name: 'Canonical relative file paths',
      status: 'pass',
      evidence: files.size + ' unique canonical relative file paths inspected.',
    });
  }

  const parsedPackage = parsePackageJson(files.get('package.json'));
  let packageJson: Record<string, unknown> | null = parsedPackage.value;
  if (parsedPackage.error) {
    checks.push({
      id: 'PKG-JSON',
      name: 'package.json syntax',
      status: 'fail',
      evidence: parsedPackage.error,
    });
    packageJson = null;
  } else if (files.has('package.json')) {
    checks.push({
      id: 'PKG-JSON',
      name: 'package.json syntax',
      status: 'pass',
      evidence: 'package.json parsed as a JSON object.',
    });
  } else {
    checks.push({
      id: 'PKG-JSON',
      name: 'package.json syntax',
      status: 'unverified',
      evidence: 'No package.json found; a static project may not require one.',
    });
  }

  const missingReferences: string[] = [];
  const undeclaredImports: string[] = [];

  // Array.from avoids ES5 downlevelIteration pitfalls with Map iterators.
  for (const [filePath, content] of Array.from(files.entries())) {
    for (const reference of collectReferences({ path: filePath, content })) {
      const specifier = reference.value.trim();

      if (
        reference.kind === 'HTML src/href' ||
        reference.kind === 'HTML resource attribute' ||
        reference.kind === 'CSS url()' ||
        reference.kind === 'CSS @import'
      ) {
        const result = resolveLocalReference(filePath, specifier, files);
        if (!result.exists) {
          missingReferences.push(
            filePath + ' -> ' + specifier + ' (' + reference.kind + ': ' + result.reason + ')',
          );
        }
        continue;
      }

      if (specifier.startsWith('@/')) {
        const result = resolveLocalReference('index.html', './' + specifier.slice(2), files);
        if (!result.exists) {
          missingReferences.push(filePath + ' -> ' + specifier + ' (project alias: ' + result.reason + ')');
        }
        continue;
      }

      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const result = resolveLocalReference(filePath, specifier, files);
        if (!result.exists) {
          missingReferences.push(filePath + ' -> ' + specifier + ' (' + reference.kind + ': ' + result.reason + ')');
        }
        continue;
      }

      if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
        if (/^(?:javascript|vbscript):/i.test(specifier)) {
          missingReferences.push(filePath + ' -> ' + specifier + ' (' + reference.kind + ': unsafe executable URL)');
        }
        continue;
      }

      if (
        !isDeclaredDependency(
          specifier,
          stringRecord(packageJson?.dependencies),
          stringRecord(packageJson?.devDependencies),
          stringRecord(packageJson?.optionalDependencies),
          stringRecord(packageJson?.peerDependencies),
        )
      ) {
        undeclaredImports.push(filePath + ' -> ' + packageName(specifier) + ' (' + reference.kind + ')');
      }
    }
  }

  checks.push({
    id: 'REF-LOCAL',
    name: 'Local links and relative imports',
    status: missingReferences.length ? 'fail' : 'pass',
    evidence: missingReferences.length
      ? missingReferences.slice(0, 50).join('\n')
      : 'No missing local references or unsafe executable URLs found by static scan.',
  });

  checks.push({
    id: 'DEP-DECL',
    name: 'Imported package declarations',
    status: undeclaredImports.length ? 'fail' : 'pass',
    evidence: undeclaredImports.length
      ? undeclaredImports.slice(0, 50).join('\n')
      : 'No undeclared bare imports found by static scan.',
  });

  const scripts = stringRecord(packageJson?.scripts);
  const commands = ['build', 'test', 'lint', 'typecheck']
    .filter((name) => typeof scripts[name] === 'string')
    .map((name) => ({
      command: 'npm run ' + name,
      status: 'unverified' as const,
      reason:
        'Not executed by the static preflight. A separate isolated CI/runtime run is required to verify this command.',
    }));

  checks.push({
    id: 'CMD-RUN',
    name: 'Project-specific commands',
    status: 'unverified',
    evidence: commands.length
      ? 'Discovered scripts: ' +
        commands.map((command) => command.command).join(', ') +
        '. Discovery does not mean they were executed.'
      : 'No standard build/test/lint/typecheck scripts discovered. No project command was executed.',
  });

  const requirementList = Array.isArray(requestedRequirements)
    ? requestedRequirements
    : [];
  const requirements = requirementList
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 20)
    .map((text, index) => ({
      id: 'REQ-' + String(index + 1).padStart(3, '0'),
      text: text.trim().slice(0, 500),
      status: 'unverified' as const,
      evidence:
        'Requirement recorded from the specification; no requirement-specific executable assertion was supplied to this preflight.',
    }));

  if (requirements.length === 0) {
    requirements.push({
      id: 'REQ-001',
      text: 'Convert the specification into explicit acceptance requirements.',
      status: 'unverified',
      evidence: 'No usable requirement list was supplied.',
    });
  }

  const status: AcceptanceStatus = checks.some((check) => check.status === 'fail')
    ? 'fail'
    : 'unverified';

  return { status, requirements, checks, commands };
}
