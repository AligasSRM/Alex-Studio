import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

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
const REQUIRED_SCRIPTS = new Set<string>(['build', 'test']);
const MAX_CAPTURE = 6000;
const MAX_PROJECT_ENTRIES = 20_000;
const MAX_PROJECT_DEPTH = 64;
const MAX_PROJECT_BYTES = 100 * 1024 * 1024;

/** Reject oversized or special-file workspaces before copying them to host temp storage. */
export function validateProjectTreeLimits(root: string): void {
  let entries = 0;
  let bytes = 0;
  const visit = (currentPath: string, depth: number): void => {
    entries += 1;
    if (entries > MAX_PROJECT_ENTRIES) throw new Error('Generated project exceeds the 20000-entry staging limit.');
    if (depth > MAX_PROJECT_DEPTH) throw new Error('Generated project exceeds the 64-level staging depth limit.');
    const stat = fs.lstatSync(currentPath);
    if (stat.isSymbolicLink()) throw new Error('Generated project must not contain symbolic links.');
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

export function isPinnedRunnerImage(image: string | undefined): image is string {
  return !!image && /^mcr\.microsoft\.com\/playwright:[^@\s]+@sha256:[a-f0-9]{64}$/.test(image);
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
  const scripts = SCRIPT_NAMES.map(name => ({ name, required: REQUIRED_SCRIPTS.has(name) })).filter(item => item.required || typeof scriptsObject[item.name] === 'string');
  return {
    kind: 'npm',
    packageJson: manifest,
    lockfileSha256: createHash('sha256').update(lockBytes).digest('hex'),
    scripts,
    preflightError: null,
  };
}

/**
 * Docker runs the project as an unprivileged UID. Temporary project roots often
 * have mode 0700 (for example, fs.mkdtemp), so mounting the caller's directory
 * directly makes it unreadable inside the container. Copy to a private staging
 * directory, then grant read/traverse permissions without following symlinks.
 */
function stageReadableProjectCopy(root: string): { sourcePath: string; cleanupPath: string } {
  validateProjectTreeLimits(root);
  const cleanupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-studio-runner-stage-'));
  const sourcePath = path.join(cleanupPath, 'source');
  try {
    fs.cpSync(root, sourcePath, { recursive: true, errorOnExist: false });
    // Re-check the copied snapshot to catch changes during staging.
    validateProjectTreeLimits(sourcePath);
    const makeReadable = (currentPath: string): void => {
      for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        const entryPath = path.join(currentPath, entry.name);
        const stat = fs.lstatSync(entryPath);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          makeReadable(entryPath);
          fs.chmodSync(entryPath, stat.mode & 0o777 | 0o555);
        } else if (stat.isFile()) {
          fs.chmodSync(entryPath, stat.mode & 0o777 | 0o444);
        }
      }
    };
    makeReadable(sourcePath);
    fs.chmodSync(sourcePath, 0o555);
    fs.chmodSync(cleanupPath, 0o755);
    return { sourcePath, cleanupPath };
  } catch (error) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Force-remove the named runner container, then ask Docker whether it remains.
 * A removal request alone is not proof that cleanup succeeded.
 */
export function removeAndVerifyContainer(containerName: string): { verified: boolean; output: string } {
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', NODE_ENV: process.env.NODE_ENV || 'production' };
  const removed = spawnSync('docker', ['rm', '--force', containerName], {
    encoding: 'utf8', timeout: 5000, env,
  });
  const inspected = spawnSync('docker', ['ps', '-a', '--filter', 'name=' + containerName, '--format', '{{.Names}}'], {
    encoding: 'utf8', timeout: 5000, env,
  });
  const removeOutput = [removed.stdout, removed.stderr, removed.error?.message].filter(Boolean).join('\n').trim();
  const inspectOutput = [inspected.stdout, inspected.stderr, inspected.error?.message].filter(Boolean).join('\n').trim();
  const names = String(inspected.stdout || '').split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  const verified = inspected.status === 0 && !names.includes(containerName);
  return {
    verified,
    output: [
      'docker rm exit: ' + (removed.status === null ? 'unavailable' : removed.status),
      'container absence verified: ' + verified,
      removeOutput,
      inspectOutput,
    ].filter(Boolean).join('\n').slice(-4000),
  };
}

function baseEvidence(name: string, required: boolean, status: CommandStatus, output: string, lockfileSha256: string | null): CommandEvidence {
  return {
    name, command: 'npm run ' + name, cwd: '/tmp/workspace', required, status,
    startedAt: null, finishedAt: null, exitCode: null, terminationReason: null,
    output: output.slice(0, MAX_CAPTURE), truncated: output.length > MAX_CAPTURE,
    ...(lockfileSha256 ? { lockfileSha256 } : {}),
  };
}

export async function runProjectCommands(root: string): Promise<CommandRun> {
  const plan = inspectGeneratedProject(root);
  if (plan.kind === 'static') {
    return { ok: true, available: true, status: 'PASS', summary: 'Static project: no npm command checks are applicable.', output: 'No package.json was present; the separate isolated browser smoke test remains the applicable execution check.', commands: [] };
  }
  if (plan.preflightError) {
    const commands = plan.scripts.map(item => baseEvidence(item.name, item.required, 'NOT RUN', plan.preflightError!, plan.lockfileSha256));
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'npm command checks unavailable during manifest/lockfile preflight', output: plan.preflightError, commands };
  }
  const scriptsObject = plan.packageJson?.scripts as Record<string, unknown>;
  const missingRequired = plan.scripts.filter(item => item.required && typeof scriptsObject[item.name] !== 'string');
  if (missingRequired.length) {
    const commands = plan.scripts.map(item => baseEvidence(item.name, item.required, typeof scriptsObject[item.name] === 'string' ? 'NOT RUN' : 'NOT RUN',
      REQUIRED_SCRIPTS.has(item.name) && typeof scriptsObject[item.name] !== 'string' ? 'Required npm script is missing.' : 'Not run because required scripts are missing.', plan.lockfileSha256));
    return { ok: false, available: true, status: 'FAIL', summary: 'Required npm scripts are missing', output: 'Required scripts missing: ' + missingRequired.map(x => x.name).join(', '), commands };
  }
  const cacheSetting = process.env.AI_RUNNER_NPM_CACHE;
  if (!cacheSetting || !path.isAbsolute(cacheSetting)) {
    const commands = plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', 'AI_RUNNER_NPM_CACHE is not configured as an absolute path.', plan.lockfileSha256));
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'Offline npm cache is not configured', output: 'Set AI_RUNNER_NPM_CACHE to a trusted, pre-populated npm cache directory. The runner never downloads dependencies.', commands };
  }
  let cacheStat: fs.Stats;
  try {
    cacheStat = fs.lstatSync(cacheSetting);
    if (!cacheStat.isDirectory() || cacheStat.isSymbolicLink()) throw new Error('cache path must be a real directory');
    const resolvedCache = fs.realpathSync(cacheSetting);
    if (resolvedCache === fs.realpathSync(root) || resolvedCache.startsWith(fs.realpathSync(root) + path.sep)) throw new Error('cache path must not be inside the draft workspace');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'cache directory is unavailable';
    const commands = plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', reason, plan.lockfileSha256));
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'Trusted offline npm cache unavailable', output: reason, commands };
  }

  const image = process.env.AI_RUNNER_DOCKER_IMAGE;
  if (!isPinnedRunnerImage(image)) {
    const message = 'AI_RUNNER_DOCKER_IMAGE must be a trusted Playwright image pinned by sha256 digest.';
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'Pinned runner image is not configured', output: message, commands: plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', message, plan.lockfileSha256)) };
  }
  let stagedSource: { sourcePath: string; cleanupPath: string };
  try {
    stagedSource = stageReadableProjectCopy(root);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'could not stage project source';
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'Could not stage project source for Docker', output: reason, commands: plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', reason, plan.lockfileSha256)) };
  }
  const containerName = 'alex-studio-runner-' + randomUUID().slice(0, 12);
  const script = String.raw`const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const commands = JSON.parse(process.env.RUNNER_COMMANDS || '[]');
const lockfileSha256 = process.env.RUNNER_LOCKFILE_SHA256 || '';
const started = new Date().toISOString();
const work = '/tmp/workspace';
const evidence = [];
let overall = 'PASS';
let installFailure = null;
const clip = (value) => { const text = String(value || ''); return { output: text.slice(0, 6000), truncated: text.length > 6000 }; };
const now = () => new Date().toISOString();
const env = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', NODE_ENV: 'test', CI: 'true', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_cache: '/tmp/npm-cache' };
try {
  fs.cpSync('/source', work, { recursive: true, errorOnExist: false });
  fs.cpSync('/npm-cache', '/tmp/npm-cache', { recursive: true, errorOnExist: false });
  const runtime = process.version;
  const npmVersion = cp.spawnSync('npm', ['--version'], { encoding: 'utf8', env, timeout: 5000 });
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8'));
  const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies'];
  const needsInstall = dependencySections.some(key => manifest[key] && Object.keys(manifest[key]).length > 0);
  const installStart = now();
  const install = needsInstall
    ? cp.spawnSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', '/tmp/npm-cache'], {
        cwd: work, encoding: 'utf8', env, timeout: 45000, maxBuffer: 200000
      })
    : { error: null, status: 0, stdout: 'No dependencies declared; skipped npm ci.\\n', stderr: '' };
  const installOutput = String(install.stdout || '') + String(install.stderr || '');
  if (install.error || install.status !== 0) {
    const offlineMiss = /ENOTCACHED|cache mode is ['"]only-if-cached|offline.*(cache|package)|no matching version found/i.test(installOutput + String(install.error || ''));
    installFailure = { reason: install.error && install.error.code === 'ETIMEDOUT' ? 'dependency install timed out' : offlineMiss ? 'required dependency is missing from the offline cache' : 'npm ci failed; see bounded output', output: clip(installOutput).output, status: offlineMiss ? 'UNAVAILABLE' : 'FAIL', startedAt: installStart, finishedAt: now(), exitCode: install.status === null ? null : install.status };
    overall = installFailure.status;
  } else {
    for (const item of commands) {
      const startedAt = now();
      const result = cp.spawnSync('npm', ['run', item.name], { cwd: work, encoding: 'utf8', env, timeout: 25000, maxBuffer: 160000 });
      const raw = String(result.stdout || '') + String(result.stderr || '');
      const terminationReason = result.error ? (result.error.code === 'ETIMEDOUT' ? 'command timed out' : String(result.error.message || result.error.code)) : null;
      const output = clip(raw);
      const status = result.error || result.status !== 0 ? 'FAIL' : 'PASS';
      evidence.push({ name: item.name, command: 'npm run ' + item.name, cwd: work, required: item.required, status, startedAt, finishedAt: now(), exitCode: result.status === null ? null : result.status, terminationReason, output: output.output, truncated: output.truncated, runtime, packageManager: 'npm ' + String(npmVersion.stdout || '').trim(), lockfileSha256 });
      if (status !== 'PASS') overall = 'FAIL';
    }
  }
  if (installFailure) {
    for (const item of commands) evidence.push({ name: item.name, command: 'npm run ' + item.name, cwd: work, required: item.required, status: installFailure.status, startedAt: installFailure.startedAt, finishedAt: installFailure.finishedAt, exitCode: installFailure.exitCode, terminationReason: installFailure.reason, output: installFailure.output, truncated: false, runtime, packageManager: 'npm ' + String(npmVersion.stdout || '').trim(), lockfileSha256 });
  }
  process.stdout.write(JSON.stringify({ available: overall !== 'UNAVAILABLE', status: overall, ok: overall === 'PASS', startedAt: started, finishedAt: now(), runtime, packageManager: 'npm ' + String(npmVersion.stdout || '').trim(), lockfileSha256, commands: evidence }));
} catch (error) {
  process.stdout.write(JSON.stringify({ available: false, status: 'UNAVAILABLE', ok: false, error: String(error && error.message || error), commands: evidence }));
  process.exitCode = 0;
}`;
  const args = ['run', '--rm', '--init', '--name', containerName, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '512m', '--cpus', '1', '--pids-limit', '64', '--user', '10001:10001', '--shm-size', '64m',
    '--tmpfs', '/tmp:rw,nosuid,size=512m,uid=10001,gid=10001,mode=700',
    '--mount', 'type=bind,src=' + stagedSource.sourcePath + ',dst=/source,readonly',
    '--mount', 'type=bind,src=' + cacheSetting + ',dst=/npm-cache,readonly',
    '--env', 'HOME=/tmp', '--env', 'RUNNER_COMMANDS=' + JSON.stringify(plan.scripts),
    '--env', 'RUNNER_LOCKFILE_SHA256=' + plan.lockfileSha256,
    image, 'node', '-e', script];
  try {
    return await new Promise<CommandRun>((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin', NODE_ENV: process.env.NODE_ENV || 'production' } });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (value: CommandRun) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const collect = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-20000);
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const cleanup = removeAndVerifyContainer(containerName);
      const status: CommandStatus = cleanup.verified ? 'FAIL' : 'UNAVAILABLE';
      const reason = cleanup.verified
        ? 'Runner wall-clock timeout; container termination and removal verified.'
        : 'Runner wall-clock timeout; container cleanup could not be verified.';
      const commands = plan.scripts.map(item => ({
        ...baseEvidence(item.name, item.required, status, reason, plan.lockfileSha256),
        terminationReason: reason,
      }));
      finish({
        ok: false, available: cleanup.verified, status,
        summary: cleanup.verified ? 'Isolated npm runner timed out' : 'Runner timed out and cleanup is unverified',
        output: ((stdout + stderr).slice(-8000) + '\n' + cleanup.output).slice(-12000),
        commands, cleanupVerified: cleanup.verified, cleanupOutput: cleanup.output,
      });
    }, 90000);
    child.on('error', error => {
      const cleanup = removeAndVerifyContainer(containerName);
      const reason = cleanup.verified
        ? error.message
        : error.message + '\\nContainer cleanup could not be verified.';
      finish({
        ok: false, available: false, status: 'UNAVAILABLE',
        summary: cleanup.verified ? 'Could not start isolated npm runner' : 'Docker unavailable and container cleanup unverified',
        output: (reason + '\\n' + cleanup.output).slice(-12000),
        commands: plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', reason, plan.lockfileSha256)),
        cleanupVerified: cleanup.verified, cleanupOutput: cleanup.output,
      });
    });
    child.on('close', code => {
      const cleanup = removeAndVerifyContainer(containerName);
      if (!cleanup.verified) {
        const reason = 'Container cleanup could not be verified; runner result is not trusted.';
        finish({
          ok: false, available: false, status: 'UNAVAILABLE', summary: reason,
          output: ((stdout + '\n' + stderr).slice(-8000) + '\n' + cleanup.output).slice(-12000),
          commands: plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', reason, plan.lockfileSha256)),
          cleanupVerified: false, cleanupOutput: cleanup.output,
        });
        return;
      }
      const raw = stdout.trim();
      let parsed: { available?: boolean; ok?: boolean; status?: CommandStatus; error?: string; commands?: CommandEvidence[] };
      try { parsed = JSON.parse(raw); } catch {
        const output = (raw + '\n' + stderr + '\nContainer cleanup verified.\n' + cleanup.output).slice(-12000);
        const unavailable = /cannot connect to the docker daemon|pull access denied|error during connect|no such image|manifest unknown|unauthorized:|denied: requested access/i.test(output);
        finish({
          ok: false, available: !unavailable, status: unavailable ? 'UNAVAILABLE' : 'FAIL',
          summary: unavailable ? 'Docker image or daemon unavailable' : 'Runner returned invalid evidence',
          output, commands: plan.scripts.map(item => baseEvidence(item.name, item.required, unavailable ? 'UNAVAILABLE' : 'FAIL', output, plan.lockfileSha256)),
          cleanupVerified: true, cleanupOutput: cleanup.output,
        });
        return;
      }
      const commands = parsed.commands || [];
      const status = parsed.status || 'UNAVAILABLE';
      finish({
        ok: code === 0 && parsed.ok === true, available: parsed.available === true, status,
        summary: parsed.ok ? 'Isolated npm command checks passed' : parsed.error || (status === 'UNAVAILABLE' ? 'Isolated npm command checks unavailable' : 'One or more npm commands failed'),
        output: ([parsed.error, stderr, commands.map(item => item.name + ': ' + item.status + '\n' + item.output).join('\n'), 'Container cleanup verified.', cleanup.output].filter(Boolean).join('\n')).slice(-12000),
        commands, cleanupVerified: true, cleanupOutput: cleanup.output,
      });
    });
    });
  } finally {
    // Read-only staged directories need write permission restored on the host
    // before their entries can be unlinked during cleanup.
    const restoreDirectoryPermissions = (currentPath: string): void => {
      fs.chmodSync(currentPath, 0o755);
      for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          restoreDirectoryPermissions(path.join(currentPath, entry.name));
        }
      }
    };
    try {
      restoreDirectoryPermissions(stagedSource.cleanupPath);
    } finally {
      fs.rmSync(stagedSource.cleanupPath, { recursive: true, force: true });
    }
  }
}
