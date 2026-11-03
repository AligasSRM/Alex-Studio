import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type CommandStatus = 'PASS' | 'FAIL' | 'NOT RUN' | 'UNAVAILABLE';
export type CommandEvidence = {
  name: string;
  command: string;
  cwd: string;
  required: boolean;
  status: CommandStatus;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  terminationReason: string | null;
  output: string;
  truncated: boolean;
  runtime?: string;
  packageManager?: string;
  lockfileSha256?: string;
};
export type CommandRun = {
  ok: boolean;
  available: boolean;
  status: CommandStatus;
  summary: string;
  output: string;
  commands: CommandEvidence[];
  cleanupVerified?: boolean;
  cleanupOutput?: string;
};

type ManifestPlan = {
  kind: 'static' | 'npm';
  packageJson: Record<string, unknown> | null;
  lockfileSha256: string | null;
  scripts: { name: string; required: boolean }[];
  preflightError: string | null;
};

const SCRIPT_NAMES = ['build', 'test', 'lint', 'typecheck'] as const;
const REQUIRED_SCRIPTS = ['build', 'test'] as const;
const MAX_CAPTURE = 6000;
const MAX_PROJECT_ENTRIES = 20_000;
const MAX_PROJECT_DEPTH = 64;
const MAX_PROJECT_BYTES = 100 * 1024 * 1024;

/** Reject oversized or special-file workspaces before any staging or execution. */
export function validateProjectTreeLimits(root: string): void {
  let entries = 0;
  let bytes = 0;
  const visit = (currentPath: string, depth: number): void => {
    entries += 1;
    if (entries > MAX_PROJECT_ENTRIES) throw new Error('Generated project exceeds the 20000-entry staging limit.');
    if (depth > MAX_PROJECT_DEPTH) throw new Error('Generated project exceeds the 64-level staging depth limit.');
    const stat = fs.lstatSync(currentPath);
    if (stat.isSymbolicLink()) throw new Error('Generated project must not contain symbolic links or junctions.');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath)) visit(path.join(currentPath, entry), depth + 1);
      return;
    }
    if (!stat.isFile()) throw new Error('Generated project contains an unsupported filesystem entry.');
    bytes += stat.size;
    if (bytes > MAX_PROJECT_BYTES) throw new Error('Generated project exceeds the 100 MiB staging limit.');
  };
  visit(root, 0);
}

export function inspectGeneratedProject(root: string): ManifestPlan {
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return { kind: 'static', packageJson: null, lockfileSha256: null, scripts: [], preflightError: null };
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('package.json must be a JSON object');
    manifest = parsed as Record<string, unknown>;
  } catch (error) {
    return { kind: 'npm', packageJson: null, lockfileSha256: null, scripts: [], preflightError: error instanceof Error ? error.message : 'Malformed package.json' };
  }
  const manager = manifest.packageManager;
  if (manager !== undefined && (typeof manager !== 'string' || !/^npm@\d+\./.test(manager))) {
    return { kind: 'npm', packageJson: manifest, lockfileSha256: null, scripts: [], preflightError: 'Only npm packageManager declarations are supported' };
  }
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return { kind: 'npm', packageJson: manifest, lockfileSha256: null, scripts: [], preflightError: 'package-lock.json is required; the runner will not generate or modify a lockfile' };
  }
  let lock: Record<string, unknown>;
  let lockBytes: Buffer;
  try {
    lockBytes = fs.readFileSync(lockPath);
    const parsed: unknown = JSON.parse(lockBytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('package-lock.json must be a JSON object');
    lock = parsed as Record<string, unknown>;
  } catch (error) {
    return { kind: 'npm', packageJson: manifest, lockfileSha256: null, scripts: [], preflightError: error instanceof Error ? error.message : 'Malformed package-lock.json' };
  }
  if (![2, 3].includes(Number(lock.lockfileVersion)) || !lock.packages || typeof lock.packages !== 'object') {
    return { kind: 'npm', packageJson: manifest, lockfileSha256: null, scripts: [], preflightError: 'Only npm lockfileVersion 2 or 3 is supported' };
  }
  const rootPackage = (lock.packages as Record<string, unknown>)[''];
  if (!rootPackage || typeof rootPackage !== 'object') {
    return { kind: 'npm', packageJson: manifest, lockfileSha256: null, scripts: [], preflightError: 'Lockfile root package metadata is missing' };
  }
  const rootMeta = rootPackage as Record<string, unknown>;
  if ((manifest.name && rootMeta.name && manifest.name !== rootMeta.name) ||
      (manifest.version && rootMeta.version && manifest.version !== rootMeta.version)) {
    return { kind: 'npm', packageJson: manifest, lockfileSha256: null, scripts: [], preflightError: 'package.json and package-lock.json root metadata do not match' };
  }
  const rawScripts = manifest.scripts;
  if (!rawScripts || typeof rawScripts !== 'object' || Array.isArray(rawScripts)) {
    return { kind: 'npm', packageJson: manifest, lockfileSha256: createHash('sha256').update(lockBytes).digest('hex'), scripts: [], preflightError: 'package.json scripts object is required' };
  }
  const scriptsObject = rawScripts as Record<string, unknown>;
  return {
    kind: 'npm',
    packageJson: manifest,
    lockfileSha256: createHash('sha256').update(lockBytes).digest('hex'),
    scripts: SCRIPT_NAMES.map(name => ({ name, required: REQUIRED_SCRIPTS.has(name) })).filter(item => item.required || typeof scriptsObject[item.name] === 'string'),
    preflightError: null,
  };
}

function evidence(name: string, required: boolean, status: CommandStatus, output: string, lockfileSha256: string | null): CommandEvidence {
  return {
    name,
    command: 'npm run ' + name,
    cwd: '<Windows-isolated-workspace-unavailable>',
    required,
    status,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    terminationReason: null,
    output: output.slice(0, MAX_CAPTURE),
    truncated: output.length > MAX_CAPTURE,
    ...(lockfileSha256 ? { lockfileSha256 } : {}),
  };
}

/**
 * Generated code must never run directly on the Windows host. The former runner was
 * removed from the approved platform scope; until a Windows-native isolation
 * provider is implemented and verified, npm execution is deliberately fail-closed.
 */
export async function runProjectCommands(root: string): Promise<CommandRun> {
  // Classify an explicitly malformed npm manifest before lockfile availability.
  // This is read-only and never invokes a generated command.
  try {
    const packagePath = path.join(root, 'package.json');
    if (fs.existsSync(packagePath)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const manifest = parsed as Record<string, unknown>;
        const rawScripts = manifest.scripts;
        if (rawScripts && typeof rawScripts === 'object' && !Array.isArray(rawScripts)) {
          const scripts = rawScripts as Record<string, unknown>;
          const missing = [...REQUIRED_SCRIPTS].filter(name => typeof scripts[name] !== 'string');
          if (missing.length) {
            const output = 'Required scripts missing: ' + missing.join(', ');
            return {
              ok: false,
              available: true,
              status: 'FAIL',
              summary: 'Required npm scripts are missing',
              output,
              commands: [...REQUIRED_SCRIPTS].map(name => evidence(name, true, 'NOT RUN', output, null)),
            };
          }
        }
      }
    }
  } catch {
    // The detailed parser below reports malformed manifests as UNAVAILABLE.
  }

  let plan: ManifestPlan;
  try {
    plan = inspectGeneratedProject(root);
  } catch (error) {
    const output = error instanceof Error ? error.message : 'Project preflight failed';
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'Project preflight unavailable', output, commands: [] };
  }

  if (plan.kind === 'static') {
    return {
      ok: true,
      available: true,
      status: 'PASS',
      summary: 'Static project: npm command checks are not applicable.',
      output: 'No package.json was present. This result does not certify browser execution or end-to-end acceptance.',
      commands: [],
    };
  }

  // A missing required script is a deterministic manifest defect. Detect it
  // from package.json before lockfile/cache availability checks; no command runs.
  const rawScripts = plan.packageJson?.scripts;
  if (rawScripts && typeof rawScripts === 'object' && !Array.isArray(rawScripts)) {
    const scripts = rawScripts as Record<string, unknown>;
    const missing = [...REQUIRED_SCRIPTS].filter(name => typeof scripts[name] !== 'string');
    if (missing.length) {
      const output = 'Required scripts missing: ' + missing.join(', ');
      return {
        ok: false,
        available: true,
        status: 'FAIL',
        summary: 'Required npm scripts are missing',
        output,
        commands: [...REQUIRED_SCRIPTS].map(name => evidence(name, true, 'NOT RUN', output, plan.lockfileSha256)),
      };
    }
  }

  if (plan.preflightError) {
    const commands = plan.scripts.map(item => evidence(item.name, item.required, 'NOT RUN', plan.preflightError!, plan.lockfileSha256));
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'npm command checks unavailable during manifest/lockfile preflight', output: plan.preflightError, commands };
  }

  const scripts = plan.packageJson?.scripts as Record<string, unknown>;
  const missing = [...REQUIRED_SCRIPTS].filter(name => typeof scripts[name] !== 'string');
  if (missing.length) {
    const output = 'Required scripts missing: ' + missing.join(', ');
    return {
      ok: false,
      available: true,
      status: 'FAIL',
      summary: 'Required npm scripts are missing',
      output,
      commands: plan.scripts.map(item => evidence(item.name, item.required, 'NOT RUN', output, plan.lockfileSha256)),
    };
  }

  const output = 'UNAVAILABLE: the Windows-native isolated execution provider is not implemented. No generated command was started. Direct host execution or a non-Windows fallback is prohibited by the locked platform scope.';
  return {
    ok: false,
    available: false,
    status: 'UNAVAILABLE',
    summary: 'Windows-native isolated execution provider is not implemented',
    output,
    commands: plan.scripts.map(item => evidence(item.name, item.required, 'UNAVAILABLE', output, plan.lockfileSha256)),
  };
}
