import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

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
  if (!image || !/^mcr\\.microsoft\\.com\\/playwright:[^@\\s]+@sha256:[a-f0-9]{64}$/.test(image)) {
    const message = 'AI_RUNNER_DOCKER_IMAGE must be a trusted Playwright image pinned by sha256 digest.';
    return { ok: false, available: false, status: 'UNAVAILABLE', summary: 'Pinned runner image is not configured', output: message, commands: plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', message, plan.lockfileSha256)) };
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
  const installStart = now();
  const install = cp.spawnSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', '/tmp/npm-cache'], {
    cwd: work, encoding: 'utf8', env, timeout: 45000, maxBuffer: 200000
  });
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
    '--mount', 'type=bind,src=' + root + ',dst=/source,readonly',
    '--mount', 'type=bind,src=' + cacheSetting + ',dst=/npm-cache,readonly',
    '--env', 'HOME=/tmp', '--env', 'RUNNER_COMMANDS=' + JSON.stringify(plan.scripts),
    '--env', 'RUNNER_LOCKFILE_SHA256=' + plan.lockfileSha256,
    image, 'node', '-e', script];
  return await new Promise<CommandRun>((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin', NODE_ENV: process.env.NODE_ENV || 'production' } });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (value: CommandRun) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const collect = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-20000);
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    const timer = setTimeout(() => {
      spawn('docker', ['rm', '--force', containerName], { stdio: 'ignore', env: { PATH: process.env.PATH || '/usr/bin:/bin', NODE_ENV: process.env.NODE_ENV || 'production' } });
      child.kill('SIGKILL');
      const commands = plan.scripts.map(item => ({ ...baseEvidence(item.name, item.required, 'FAIL', 'Runner wall-clock timeout; container termination requested.', plan.lockfileSha256), terminationReason: 'runner wall-clock timeout' }));
      finish({ ok: false, available: true, status: 'FAIL', summary: 'Isolated npm runner timed out', output: (stdout + stderr).slice(-12000), commands });
    }, 90000);
    child.on('error', error => {
      const unavailable = /ENOENT|not found/i.test(error.message);
      finish({ ok: false, available: false, status: 'UNAVAILABLE', summary: unavailable ? 'Docker unavailable' : 'Could not start isolated npm runner', output: error.message, commands: plan.scripts.map(item => baseEvidence(item.name, item.required, 'UNAVAILABLE', error.message, plan.lockfileSha256)) });
    });
    child.on('close', code => {
      const raw = stdout.trim();
      let parsed: { available?: boolean; ok?: boolean; status?: CommandStatus; error?: string; commands?: CommandEvidence[] };
      try { parsed = JSON.parse(raw); } catch {
        const output = (raw + '\n' + stderr).slice(-12000);
        const unavailable = /cannot connect to the docker daemon|unable to find image|pull access denied|error during connect|no such image/i.test(output);
        finish({ ok: false, available: !unavailable, status: unavailable ? 'UNAVAILABLE' : 'FAIL', summary: unavailable ? 'Docker image or daemon unavailable' : 'Runner returned invalid evidence', output, commands: plan.scripts.map(item => baseEvidence(item.name, item.required, unavailable ? 'UNAVAILABLE' : 'FAIL', output, plan.lockfileSha256)) });
        return;
      }
      const commands = parsed.commands || [];
      const status = parsed.status || 'UNAVAILABLE';
      finish({ ok: code === 0 && parsed.ok === true, available: parsed.available === true, status, summary: parsed.ok ? 'Isolated npm command checks passed' : parsed.error || (status === 'UNAVAILABLE' ? 'Isolated npm command checks unavailable' : 'One or more npm commands failed'), output: (stderr + commands.map(item => item.name + ': ' + item.status + '\n' + item.output).join('\n')).slice(-12000), commands });
    });
  });
}
