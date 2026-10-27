export const runtime = 'nodejs';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation, resolveProjectPath } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { listProjectFiles, readProjectFile } from '@/lib/files';
import { checkRateLimit } from '@/lib/rate-limit';
import { estimateAICostUsd, recordAIUsage } from '@/lib/ai-usage';\nimport { analyzeGeneratedProject } from '@/lib/ai-acceptance';

const MAX_FILES = 10;
const MAX_ROUNDS = 2;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const SENSITIVE_PATH = /(^|\/)(\.env[^/]*|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*|node_modules|\.git|\.alex)(\/|$)/i;
const IMAGE = 'mcr.microsoft.com/playwright:v1.56.1-noble';
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
type FileDraft = { path: string; content: string; baseHash: string | null };
type Result = { ok: boolean; available: boolean; summary: string; output: string };

const runner = [
  "const { chromium } = require('playwright');",
  "(async () => {",
  " const errors = []; const browser = await chromium.launch({ headless: true });",
  " try { const page = await browser.newPage();",
  " page.on('pageerror', e => errors.push('pageerror: ' + e.message));",
  " page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });",
  " page.on('requestfailed', r => errors.push('request failed: ' + r.url()));",
  " await page.goto('file:///workspace/index.html', { waitUntil: 'load', timeout: 10000 });",
  " const body = (await page.locator('body').innerText().catch(() => '')).trim();",
  " if (!body) errors.push('The page body is empty');",
  " process.stdout.write(JSON.stringify({ ok: !errors.length, title: await page.title().catch(() => ''), errors }) + '\\n');",
  " if (errors.length) process.exitCode = 1; } finally { await browser.close(); }",
  "})().catch(e => { process.stderr.write(String(e.stack || e)); process.exitCode = 1; });",
].join('\n');

function safePath(projectId: string, value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid AI file path');
  const normalized = value.replace(/\\/g, '/');
  resolveProjectPath(projectId, normalized);
  if (normalized !== value || SENSITIVE_PATH.test(normalized)) {
    throw new Error('Protected or non-canonical path denied');
  }
  return normalized;
}
function parseDraft(projectId: string, input: unknown, current: Map<string, string>, checkHash: boolean): FileDraft[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_FILES) throw new Error('Invalid file batch');
  const seen = new Set<string>();
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid file change');
    const item = raw as { path?: unknown; content?: unknown; baseHash?: unknown };
    const filePath = safePath(projectId, item.path);
    if (typeof item.content !== 'string' || item.content.includes('\0') || Buffer.byteLength(item.content, 'utf8') > 262144) throw new Error('Invalid or oversized file');
    if (seen.has(filePath)) throw new Error('Duplicate path');
    seen.add(filePath);
    const old = current.get(filePath);
    const expected = old === undefined ? null : hash(old);
    if (checkHash && item.baseHash !== expected) throw new Error('Stale draft; generate a fresh draft');
    return { path: filePath, content: item.content, baseHash: expected };
  });
}
function runSandbox(root: string): Promise<Result> {
  return new Promise((resolve) => {
    const modules = path.join(process.cwd(), 'node_modules');
    if (!fs.existsSync(path.join(modules, 'playwright'))) {
      resolve({ ok: false, available: false, summary: 'Playwright is not installed', output: 'Install dependencies before sandbox verification.' }); return;
    }
    const args = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '256m', '--cpus', '1', '--pids-limit', '64', '--user', '10001:10001', '--shm-size', '64m',
      '--tmpfs', '/tmp:rw,nosuid,size=64m', '--mount', 'type=bind,src=' + root + ',dst=/workspace,readonly',
      '--mount', 'type=bind,src=' + modules + ',dst=/app/node_modules,readonly', '--env', 'NODE_PATH=/app/node_modules', '--env', 'HOME=/tmp', '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
      IMAGE, 'node', '-e', runner];
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin', NODE_ENV: process.env.NODE_ENV || 'production' } });
    let output = ''; let settled = false;
    const finish = (result: Result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const collect = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-12000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, available: true, summary: 'Sandbox timed out', output }); }, 20000);
    child.on('error', e => finish({ ok: false, available: false, summary: 'Docker unavailable', output: e.message }));
    child.on('close', code => {
      const unavailable = /cannot connect to the docker daemon|unable to find image|pull access denied|error during connect/i.test(output);
      finish({ ok: code === 0, available: !unavailable, summary: code === 0 ? 'Isolated browser test passed' : unavailable ? 'Docker sandbox unavailable' : 'Isolated browser test failed', output });
    });
  });
}
async function getRepair(apiKey: string, model: string, projectId: string, prompt: string, files: { path: string; content: string }[], result: Result, current: Map<string, string>) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_output_tokens: 12000,
      instructions: 'Repair the supplied static HTML/CSS/JS project using the isolated browser diagnostics. Return only JSON: {"summary":"...","files":[{"path":"relative/path","content":"complete file content"}]}. Maximum 10 files, each under 256 KiB. Use canonical relative paths only. Never change hidden paths, secrets, node_modules, .git, .alex or lockfiles. Do not include host shell commands. Do not claim tests passed unless diagnostics prove it.',
      input: JSON.stringify({ request: prompt, diagnostics: result, files }) }),
  });
  if (!response.ok) throw new Error('AI repair request failed (' + response.status + ')');
  const data = await response.json() as { output_text?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
  if (typeof data.output_text !== 'string') throw new Error('Invalid AI repair response');
  const parsed = JSON.parse(data.output_text.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '')) as { summary?: unknown; files?: unknown };
  if (typeof parsed.summary !== 'string') throw new Error('AI repair omitted summary');
  const filesOut = parseDraft(projectId, parsed.files, current, false);
  const inputTokens = Number.isInteger(data.usage?.input_tokens) ? data.usage?.input_tokens as number : null;
  const outputTokens = Number.isInteger(data.usage?.output_tokens) ? data.usage?.output_tokens as number : null;
  recordAIUsage(projectId, { timestamp: new Date().toISOString(), model, inputTokens, outputTokens, estimatedCostUsd: estimateAICostUsd(inputTokens, outputTokens) });
  return { summary: parsed.summary.slice(0, 1000), files: filesOut };
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  const rate = checkRateLimit('ai-iterate:' + new URL(request.url).host, 3, 60000);
  if (!rate.allowed) return NextResponse.json({ error: 'AI verify/repair rate limit exceeded' }, { status: 429 });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  const rawBody = await request.text().catch(() => '');
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  type IterateRequestBody = { projectId?: unknown; prompt?: unknown; files?: unknown; requirements?: unknown; approved?: unknown };
  let body: IterateRequestBody;
  try { body = JSON.parse(rawBody) as IterateRequestBody; } catch { return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 }); }
  if (!body || typeof body.projectId !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000 || !Array.isArray(body.files)) {
    return NextResponse.json({ error: 'projectId, prompt, and draft files are required' }, { status: 400 });
  }
  if (body.approved !== true) return NextResponse.json({ error: 'Explicit approval required before paid AI repair calls' }, { status: 409 });
  if (!getProject(body.projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI provider is not configured on this server' }, { status: 503 });
  let root = '';
  try {
    const originals = new Map<string, string>(); const working = new Map<string, string>(); let total = 0;
    for (const entry of listProjectFiles(body.projectId).filter(x => x.type === 'file')) {
      if (SENSITIVE_PATH.test(entry.path)) continue;
      const content = readProjectFile(body.projectId, entry.path); total += Buffer.byteLength(content, 'utf8');
      if (total > 5 * 1024 * 1024) throw new Error('Project exceeds 5 MiB sandbox limit');
      originals.set(entry.path, content); working.set(entry.path, content);
    }
    for (const file of parseDraft(body.projectId, body.files, originals, true)) working.set(file.path, file.content);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-studio-ai-')); fs.chmodSync(root, 0o755);
    const writeFiles = () => {
      for (const [filePath, content] of Array.from(working.entries())) {
        const target = path.resolve(root, ...filePath.split('/')); const relative = path.relative(root, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Sandbox path escape denied');
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
        fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'w', mode: 0o644 });
      }
    };
    writeFiles();
    let diagnostic = await runSandbox(root);
    if (!diagnostic.available) return NextResponse.json({ error: 'Isolated execution is unavailable; no repair was attempted and project files were not changed.', diagnostic }, { status: 503 });
    const repairs: { round: number; summary: string; diagnostic: Result }[] = [];
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    for (let round = 1; !diagnostic.ok && round <= MAX_ROUNDS; round++) {
      const context: { path: string; content: string }[] = []; let bytes = 0;
      for (const [filePath, content] of Array.from(working.entries())) {
        if (SENSITIVE_PATH.test(filePath)) continue;
        const excerpt = content.slice(0, 8000); bytes += Buffer.byteLength(excerpt, 'utf8');
        if (bytes > 48 * 1024) break; context.push({ path: filePath, content: excerpt });
      }
      let next;
      try { next = await getRepair(apiKey, model, body.projectId, body.prompt, context, diagnostic, working); }
      catch (e) { repairs.push({ round, summary: e instanceof Error ? e.message : 'AI repair failed', diagnostic }); break; }
      for (const file of next.files) working.set(file.path, file.content);
      fs.rmSync(root, { recursive: true, force: true }); root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-studio-ai-')); fs.chmodSync(root, 0o755); writeFiles();
      diagnostic = await runSandbox(root);
      repairs.push({ round, summary: next.summary, diagnostic });
      if (!diagnostic.available) break;
    }
    const changed: FileDraft[] = [];
    for (const [filePath, content] of Array.from(working.entries())) if (originals.get(filePath) !== content) {
      const old = originals.get(filePath); changed.push({ path: filePath, content, baseHash: old === undefined ? null : hash(old) });
    }
    if (!changed.length || changed.length > MAX_FILES) return NextResponse.json({ error: 'Final draft must contain 1–10 changed files', diagnostic, repairs }, { status: 422 });
    const acceptance = analyzeGeneratedProject(Array.from(working.entries()).map(([filePath, content]) => ({ path: filePath, content })), body.requirements);\n    return NextResponse.json({ ok: diagnostic.ok && acceptance.status === 'pass', summary: diagnostic.ok ? 'Isolated browser smoke test passed; inspect the acceptance report for checks that remain unverified.' : 'Repair loop ended with failures; inspect diagnostics before applying.', diagnostic, repairs, acceptance,
      build: { summary: 'Verified draft; not applied to the real project.', plan: repairs.map(x => 'Repair round ' + x.round + ': ' + x.summary), files: changed }, appliedToProject: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI verify/repair failed' }, { status: 400 });
  } finally { if (root) fs.rmSync(root, { recursive: true, force: true }); }
}
