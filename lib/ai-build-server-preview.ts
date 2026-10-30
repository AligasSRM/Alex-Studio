import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { APPROVED_RUNNER_IMAGE, isPinnedRunnerImage, removeAndVerifyContainer, validateProjectTreeLimits } from './ai-command-runner';

export type BuildPreviewResult = {
  ok: boolean;
  available: boolean;
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  summary: string;
  output: string;
  url: string | null;
  pageSnapshot: { title: string; body: string; errors: string[] } | null;
  cleanupVerified: boolean;
};

const fail = (status: BuildPreviewResult['status'], summary: string, output: string): BuildPreviewResult => ({
  ok: false, available: status !== 'UNAVAILABLE', status, summary, output, url: null, pageSnapshot: null, cleanupVerified: false,
});

/**
 * Build and preview an npm application entirely inside the pinned, networkless
 * Docker runner. Host project files and the trusted npm cache are mounted read-only.
 * Supported server entry points: npm start or npm preview. The server is started
 * and exercised by Playwright in the same container, then terminated before exit.
 */
export async function runBuildServerPreview(root: string): Promise<BuildPreviewResult> {
  const manifestPath = path.join(root, 'package.json');
  if (!fs.existsSync(manifestPath)) return fail('UNAVAILABLE', 'Build/server preview is not applicable to a project without package.json', 'Static projects use the existing isolated file:// browser runner.');
  let manifest: { scripts?: Record<string, unknown> };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as typeof manifest;
  } catch {
    return fail('UNAVAILABLE', 'Build/server preview requires a valid package.json', 'package.json could not be parsed.');
  }
  const scripts = manifest.scripts || {};
  if (typeof scripts.build !== 'string' || !(typeof scripts.start === 'string' || typeof scripts.preview === 'string')) {
    return fail('UNAVAILABLE', 'Project must define build and start (or preview) scripts', 'No supported build + server lifecycle was detected; refusing to substitute a static-file smoke test.');
  }
  const cache = process.env.AI_RUNNER_NPM_CACHE;
  if (!cache || !path.isAbsolute(cache)) return fail('UNAVAILABLE', 'Trusted offline npm cache is not configured', 'AI_RUNNER_NPM_CACHE must point to a pre-populated cache directory.');
  try {
    const stat = fs.lstatSync(cache);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('cache must be a real directory');
    const realCache = fs.realpathSync(cache);
    const realRoot = fs.realpathSync(root);
    if (realCache === realRoot || realCache.startsWith(realRoot + path.sep) || realRoot.startsWith(realCache + path.sep)) {
      throw new Error('cache directory must be separate from the generated project workspace');
    }
  } catch (error) {
    return fail('UNAVAILABLE', 'Trusted offline npm cache is unavailable', error instanceof Error ? error.message : String(error));
  }
  const image = process.env.AI_RUNNER_DOCKER_IMAGE || APPROVED_RUNNER_IMAGE;
  if (!isPinnedRunnerImage(image)) return fail('UNAVAILABLE', 'Approved pinned Docker image is not configured', 'Only the reviewed Playwright image digest is allowed.');
  const modules = path.join(process.cwd(), 'node_modules');
  if (!fs.existsSync(path.join(modules, 'playwright'))) return fail('UNAVAILABLE', 'Playwright browser package is unavailable', 'The host application Playwright package must be installed before isolated preview.');
  try { validateProjectTreeLimits(root); } catch (error) {
    return fail('UNAVAILABLE', 'Project cannot be staged safely', error instanceof Error ? error.message : String(error));
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-studio-build-preview-'));
  const source = path.join(staging, 'source');
  const name = 'alex-studio-preview-' + randomUUID().slice(0, 12);
  try {
    fs.cpSync(root, source, { recursive: true });
    validateProjectTreeLimits(source);
    const makeReadable = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink()) throw new Error('Symbolic links are not permitted in the build workspace');
        if (stat.isDirectory()) { makeReadable(target); fs.chmodSync(target, stat.mode & 0o777 | 0o555); }
        else if (stat.isFile()) fs.chmodSync(target, stat.mode & 0o777 | 0o444);
      }
    };
    makeReadable(source);
    fs.chmodSync(source, 0o555);
    fs.chmodSync(staging, 0o755);

    const script = String.raw`const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const http = require('node:http');
const { chromium } = require('playwright');
const root = '/tmp/workspace';
const env = { PATH: process.env.PATH, HOME: '/tmp', TMPDIR: '/tmp', CI: 'true', NODE_ENV: 'production', PORT: '4173', HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_cache: '/tmp/npm-cache' };
const output = [];
const log = (label, value) => output.push(label + ': ' + String(value || '').slice(-5000));
const run = (cmd, args, timeout) => {
  const result = cp.spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 150000 });
  log(cmd + ' ' + args.join(' '), String(result.stdout || '') + String(result.stderr || ''));
  if (result.error || result.status !== 0) throw new Error(cmd + ' failed: ' + (result.error ? result.error.message : result.status));
};
(async () => {
  let server = null; let browser = null; let page = null; let serverClosed = false;
  const errors = [];
  try {
    fs.cpSync('/source', root, { recursive: true });
    fs.cpSync('/npm-cache', '/tmp/npm-cache', { recursive: true });
    run('npm', ['ci', '--offline', '--no-audit', '--no-fund', '--cache', '/tmp/npm-cache'], 45000);
    run('npm', ['run', 'build'], 60000);
    const startName = process.env.PREVIEW_SCRIPT;
    server = cp.spawn('npm', ['run', startName], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    server.stdout.on('data', chunk => log('server stdout', chunk.toString()));
    server.stderr.on('data', chunk => log('server stderr', chunk.toString()));
    server.on('error', error => errors.push('server process: ' + error.message));
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (server.exitCode !== null) throw new Error('Preview server exited before readiness');
      try {
        const response = await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(700) });
        if (response.status < 500) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Preview server readiness timed out after 20 seconds');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    page.on('pageerror', error => errors.push('pageerror: ' + error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    page.on('requestfailed', request => errors.push('request failed: ' + request.url()));
    const response = await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle', timeout: 15000 });
    if (!response || response.status() >= 400) errors.push('Preview returned HTTP ' + (response ? response.status() : 'no response'));
    const body = (await page.locator('body').innerText().catch(() => '')).trim();
    if (!body) errors.push('Preview page body is empty');
    const snapshot = { title: await page.title().catch(() => ''), body: body.slice(0, 12000), errors };
    if (errors.length) throw new Error('Browser acceptance failed: ' + JSON.stringify(snapshot));
    log('browser snapshot', JSON.stringify(snapshot));
    process.stdout.write(JSON.stringify({ ok: true, snapshot, output: output.join('\\n') }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message || error), output: output.join('\\n') }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server && server.pid) {
      try { process.kill(-server.pid, 'SIGTERM'); } catch {}
      await Promise.race([new Promise(resolve => server.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (server.exitCode === null) {
        try { process.kill(-server.pid, 'SIGKILL'); } catch {}
        await Promise.race([new Promise(resolve => server.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
      }
      serverClosed = server.exitCode !== null;
    } else serverClosed = true;
    if (!serverClosed) {
      process.stderr.write('\\nPREVIEW_SERVER_CLEANUP_UNVERIFIED');
      process.exitCode = 1;
    }
  }
})().catch(error => { process.stderr.write(String(error && error.stack || error)); process.exitCode = 1; });`;
    const args = [
      'run', '--rm', '--init', '--name', name, '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '768m',
      '--cpus', '1', '--pids-limit', '96', '--user', '10001:10001', '--shm-size', '128m',
      '--tmpfs', '/tmp:rw,nosuid,size=512m,uid=10001,gid=10001,mode=700',
      '--mount', 'type=bind,src=' + source + ',dst=/source,readonly',
      '--mount', 'type=bind,src=' + cache + ',dst=/npm-cache,readonly',
      '--mount', 'type=bind,src=' + modules + ',dst=/app/node_modules,readonly',
      '--env', 'NODE_PATH=/app/node_modules', '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
      '--env', 'PREVIEW_SCRIPT=' + (typeof scripts.start === 'string' ? 'start' : 'preview'),
      image, 'node', '-e', script,
    ];
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>(resolve => {
      const child = spawn('docker', args, { env: { PATH: process.env.PATH || '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = ''; let timedOut = false;
      child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-16000); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 110000);
      child.on('error', error => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr + error.message, timedOut }); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    });
    const cleanup = removeAndVerifyContainer(name);
    let parsed: { ok?: boolean; error?: string; snapshot?: BuildPreviewResult['pageSnapshot']; output?: string } = {};
    try { parsed = JSON.parse(result.stdout.trim()); } catch {}
    const output = [result.stdout, result.stderr, parsed.output, cleanup.output].filter(Boolean).join('\n').slice(-20000);
    if (!cleanup.verified) return { ...fail('UNAVAILABLE', 'Docker container cleanup could not be verified', output), cleanupVerified: false };
    if (result.timedOut) return { ...fail('FAIL', 'Build/server preview exceeded the 110-second limit; container removal verified', output), cleanupVerified: true };
    if (result.code !== 0 || parsed.ok !== true) {
      const unavailable = /cannot connect to the docker daemon|no such image|pull access denied|error during connect|ENOTCACHED|offline cache/i.test(output);
      return { ...fail(unavailable ? 'UNAVAILABLE' : 'FAIL', parsed.error || 'Build/server preview failed', output), cleanupVerified: true };
    }
    return { ok: true, available: true, status: 'PASS', summary: 'Build completed, preview server became ready, browser acceptance passed, and cleanup was verified.', output, url: 'http://127.0.0.1:4173', pageSnapshot: parsed.snapshot || null, cleanupVerified: true };
  } catch (error) {
    return fail('UNAVAILABLE', 'Build/server preview could not be staged safely', error instanceof Error ? error.message : String(error));
  } finally {
    const restore = (dir: string): void => {
      fs.chmodSync(dir, 0o755);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) restore(path.join(dir, entry.name));
    };
    try { restore(staging); } catch {}
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
