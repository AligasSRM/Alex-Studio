export const runtime = 'nodejs';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation, resolveProjectPath } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { listProjectFiles, readProjectFile } from '@/lib/files';
import { checkRateLimit } from '@/lib/rate-limit';
import { estimateAICostUsd, recordAIUsage } from '@/lib/ai-usage';
import { analyzeGeneratedProject } from '@/lib/ai-acceptance';
import { evaluateRequirements, parseBrowserSnapshot, type RequirementEvidence } from '@/lib/ai-requirement-evidence';
import { issueVerificationProof } from '@/lib/ai-verification-proof';
import { APPROVED_RUNNER_IMAGE, isPinnedRunnerImage, removeAndVerifyContainer, runProjectCommands, inspectGeneratedProject, type CommandRun } from '@/lib/ai-command-runner';
import { runBuildServerPreview } from '@/lib/ai-build-server-preview';
import { readJsonBody } from '@/lib/request-body';
import { extractAIResponseText } from '@/lib/ai-response';
import { isProtectedAIGeneratedPath } from '@/lib/ai-path-policy';

const MAX_FILES = 10;
const MAX_ROUNDS = 2;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const SENSITIVE_PATH = /(^|\/)(\.env[^/]*|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*|node_modules|\.git|\.alex)(\/|$)/i;
const IMAGE = APPROVED_RUNNER_IMAGE;
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
type FileDraft = { path: string; content: string; baseHash: string | null };
type Result = { ok: boolean; available: boolean; summary: string; output: string; commandChecks?: CommandRun; pageSnapshot?: { title: string; body: string; errors: string[] } | null; requirementEvidence?: RequirementEvidence[] };

async function verifyProject(root: string, requestedRequirements: unknown): Promise<Result> {
  const commands = await runProjectCommands(root);
  const npmProject = inspectGeneratedProject(root).kind === 'npm';
  const browser = npmProject ? await runBuildServerPreview(root) : await runSandbox(root);
  const requirementEvidence = evaluateRequirements(requestedRequirements, browser.pageSnapshot);
  const failedRequirements = requirementEvidence.filter(item => item.status === 'fail');
  const ok = browser.ok && commands.ok && failedRequirements.length === 0;
  const available = browser.available && commands.available;
  return {
    ok, available, pageSnapshot: browser.pageSnapshot, requirementEvidence,
    summary: !available ? 'Verification unavailable; inspect build/server preview and command-runner diagnostics.'
      : failedRequirements.length ? 'One or more deterministic user requirements failed; repair and re-test are required.'
      : ok ? 'Build/server preview (or static browser smoke test), deterministic requirements, and applicable project commands passed.'
      : 'Build, server readiness, browser acceptance, or project commands failed.',
    output: [
      (npmProject ? 'BUILD + SERVER PREVIEW: ' : 'BROWSER SMOKE TEST: ') + browser.summary, browser.output,
      'USER REQUIREMENT EVIDENCE: ' + JSON.stringify(requirementEvidence),
      'PROJECT COMMAND RUNNER: ' + commands.status + ' — ' + commands.summary, commands.output,
    ].join('\\n').slice(-20000),
    commandChecks: commands,
  };
}

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
  " process.stdout.write(JSON.stringify({ ok: !errors.length, title: await page.title().catch(() => ''), body: body.slice(0, 12000), errors }) + '\\n');",
  " if (errors.length) process.exitCode = 1; } finally { await browser.close(); }",
  "})().catch(e => { process.stderr.write(String(e.stack || e)); process.exitCode = 1; });",
].join('\n');

function safePath(projectId: string, value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid AI file path');
  const normalized = value.replace(/\\/g, '/');
  resolveProjectPath(projectId, normalized);
  if (normalized !== value || normalized !== normalized.trim() || isProtectedAIGeneratedPath(normalized)) {
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
export function runSandbox(root: string): Promise<Result> {
  return new Promise((resolve) => {
    if (!isPinnedRunnerImage(IMAGE)) {
      resolve({ ok: false, available: false, summary: 'Approved Docker runner image is not configured', output: 'Browser verification refused an image outside the explicit allowlist.' });
      return;
    }
    const modules = path.join(process.cwd(), 'node_modules');
    if (!fs.existsSync(path.join(modules, 'playwright'))) {
      resolve({ ok: false, available: false, summary: 'Playwright is not installed', output: 'Install dependencies before sandbox verification.' }); return;
    }
    const containerName = 'alex-studio-browser-' + randomUUID().slice(0, 12);
    const args = ['run', '--rm', '--init', '--name', containerName, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '768m', '--cpus', '1', '--pids-limit', '96', '--user', '10001:10001', '--shm-size', '128m',
      '--tmpfs', '/tmp:rw,nosuid,size=64m', '--mount', 'type=bind,src=' + root + ',dst=/workspace,readonly',
      '--mount', 'type=bind,src=' + modules + ',dst=/app/node_modules,readonly', '--env', 'NODE_PATH=/app/node_modules', '--env', 'HOME=/tmp', '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
      IMAGE, 'node', '-e', runner];
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin', NODE_ENV: process.env.NODE_ENV || 'production' } });
    let output = ''; let settled = false; let timedOut = false;
    let timeoutFallback: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: Result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (timeoutFallback) clearTimeout(timeoutFallback);
        resolve(result);
      }
    };
    const collect = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-12000); };
    const cleanupResult = () => removeAndVerifyContainer(containerName);
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    // Do not inspect/remove the container until the Docker CLI has exited. Otherwise a
    // timeout can race with "docker run" creating the named container after cleanup
    // already reported that no container existed.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      // Bound the request if the process never emits close, but do not claim cleanup
      // is verified while the container-creating CLI has not been observed exiting.
      timeoutFallback = setTimeout(() => {
        const cleanup = cleanupResult();
        finish({ ok: false, available: false, summary: 'Sandbox timed out; Docker CLI close was not observed and container cleanup is unverified',
          output: (output + '\nDocker CLI close was not observed.\n' + cleanup.output).slice(-16000) });
      }, 5000);
    }, 20000);
    child.on('error', e => {
      if (settled) {
        if (timedOut) cleanupResult();
        return;
      }
      const cleanup = cleanupResult();
      finish({ ok: false, available: false, summary: cleanup.verified ? 'Docker unavailable' : 'Docker unavailable and container cleanup unverified', output: (e.message + '\n' + cleanup.output).slice(-16000) });
    });
    child.on('close', code => {
      if (settled) {
        if (timedOut) cleanupResult();
        return;
      }
      if (timeoutFallback) clearTimeout(timeoutFallback);
      const cleanup = cleanupResult();
      const unavailable = /cannot connect to the docker daemon|unable to find image|pull access denied|error during connect/i.test(output);
      if (!cleanup.verified) {
        finish({ ok: false, available: false, summary: timedOut ? 'Sandbox timed out; container cleanup unverified' : 'Browser runner cleanup could not be verified', output: (output + '\n' + cleanup.output).slice(-16000) });
        return;
      }
      if (timedOut) {
        finish({ ok: false, available: true, summary: 'Sandbox timed out; container removal verified', output: (output + '\n' + cleanup.output).slice(-16000) });
        return;
      }
      finish({ ok: code === 0, available: !unavailable, summary: code === 0 ? 'Isolated browser test passed; container cleanup verified' : unavailable ? 'Docker sandbox unavailable' : 'Isolated browser test failed; container cleanup verified', pageSnapshot: parseBrowserSnapshot(output), output: (output + '\n' + cleanup.output).slice(-16000) });
    });
  });
}
async function getRepair(apiKey: string | undefined, model: string, provider: 'openai' | 'groq' | 'ollama', projectId: string, prompt: string, files: { path: string; content: string }[], result: Result, current: Map<string, string>) {
  const instructions = 'Repair the supplied static HTML/CSS/JS project using the isolated browser diagnostics. Return only JSON: {"summary":"...","files":[{"path":"relative/path","content":"complete file content"}]}. Maximum 10 files, each under 256 KiB. Use canonical relative paths only. Never change hidden paths, secrets, node_modules, .git, .alex or lockfiles. Do not include host shell commands. Do not claim tests passed unless diagnostics prove it.';
  const input = JSON.stringify({ request: prompt, diagnostics: result, files });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider === 'ollama' ? 120_000 : 30_000);
  let response: Response;
  try {
    response = await fetch(provider === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : provider === 'groq' ? 'https://api.groq.com/openai/v1/responses' : 'https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: provider === 'ollama' ? { 'Content-Type': 'application/json' } : { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(provider === 'ollama'
        ? { model, stream: false, format: 'json', messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }], options: { num_predict: 12000 } }
        : { model, max_output_tokens: 12000, instructions, input, text: { format: { type: 'json_object' } } }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('AI repair request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error('AI repair request failed (' + response.status + ')');
  const data = await response.json() as { output_text?: unknown; output?: unknown; message?: { content?: unknown }; usage?: { input_tokens?: unknown; output_tokens?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown };
  const outputText = extractAIResponseText(data);
  if (typeof outputText !== 'string') throw new Error('Invalid AI repair response');
  const parsed = JSON.parse(outputText.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '')) as { summary?: unknown; files?: unknown };
  if (typeof parsed.summary !== 'string') throw new Error('AI repair omitted summary');
  const filesOut = parseDraft(projectId, parsed.files, current, false);
  const inputTokens = Number.isInteger(provider === 'ollama' ? data.prompt_eval_count : data.usage?.input_tokens) ? (provider === 'ollama' ? data.prompt_eval_count : data.usage?.input_tokens) as number : null;
  const outputTokens = Number.isInteger(provider === 'ollama' ? data.eval_count : data.usage?.output_tokens) ? (provider === 'ollama' ? data.eval_count : data.usage?.output_tokens) as number : null;
  const estimatedCostUsd = provider === 'ollama' ? 0 : provider === 'groq' ? null : estimateAICostUsd(inputTokens, outputTokens);
  recordAIUsage(projectId, { timestamp: new Date().toISOString(), model, inputTokens, outputTokens, estimatedCostUsd });
  return { summary: parsed.summary.slice(0, 1000), files: filesOut };
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  const rate = checkRateLimit('ai-iterate:' + new URL(request.url).host, 3, 60000);
  if (!rate.allowed) return NextResponse.json({ error: 'AI verify/repair rate limit exceeded' }, { status: 429 });
  const parsedBody = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
  type IterateRequestBody = { projectId?: unknown; prompt?: unknown; files?: unknown; requirements?: unknown; approved?: unknown };
  if (!parsedBody.value || typeof parsedBody.value !== 'object' || Array.isArray(parsedBody.value)) {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }
  const body = parsedBody.value as IterateRequestBody;
  if (!body || typeof body.projectId !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000 || !Array.isArray(body.files)) {
    return NextResponse.json({ error: 'projectId, prompt, and draft files are required' }, { status: 400 });
  }
  if (body.approved !== true) return NextResponse.json({ error: 'Explicit approval required before paid AI repair calls' }, { status: 409 });
  if (!getProject(body.projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const provider = process.env.AI_PROVIDER === 'ollama' ? 'ollama' : process.env.AI_PROVIDER === 'groq' ? 'groq' : 'openai';
  const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : provider === 'openai' ? process.env.OPENAI_API_KEY : undefined;
  if (provider !== 'ollama' && !apiKey) return NextResponse.json({ error: provider === 'groq' ? 'Groq is selected but GROQ_API_KEY is not configured.' : 'AI provider is not configured on this server' }, { status: 503 });
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
    let diagnostic = await verifyProject(root, body.requirements);
    let commandChecks = diagnostic.commandChecks!;
    if (!diagnostic.available) return NextResponse.json({ error: 'Isolated verification is unavailable; no repair was attempted and project files were not changed.', diagnostic, commandChecks }, { status: 503 });
    const repairs: { round: number; summary: string; diagnostic: Result }[] = [];
    const model = provider === 'ollama' ? (process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b') : provider === 'groq' ? (process.env.GROQ_MODEL || 'openai/gpt-oss-20b') : (process.env.OPENAI_MODEL || 'gpt-4.1-mini');
    for (let round = 1; !diagnostic.ok && round <= MAX_ROUNDS; round++) {
      const context: { path: string; content: string }[] = []; let bytes = 0;
      for (const [filePath, content] of Array.from(working.entries())) {
        if (SENSITIVE_PATH.test(filePath)) continue;
        const excerpt = content.slice(0, 8000); bytes += Buffer.byteLength(excerpt, 'utf8');
        if (bytes > 48 * 1024) break; context.push({ path: filePath, content: excerpt });
      }
      let next;
      try { next = await getRepair(apiKey, model, provider, body.projectId, body.prompt, context, diagnostic, working); }
      catch (e) { repairs.push({ round, summary: e instanceof Error ? e.message : 'AI repair failed', diagnostic }); break; }
      for (const file of next.files) working.set(file.path, file.content);
      fs.rmSync(root, { recursive: true, force: true }); root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-studio-ai-')); fs.chmodSync(root, 0o755); writeFiles();
      diagnostic = await verifyProject(root, body.requirements);
      commandChecks = diagnostic.commandChecks!;
      repairs.push({ round, summary: next.summary, diagnostic });
      if (!diagnostic.available) break;
    }
    const changed: FileDraft[] = [];
    for (const [filePath, content] of Array.from(working.entries())) if (originals.get(filePath) !== content) {
      const old = originals.get(filePath); changed.push({ path: filePath, content, baseHash: old === undefined ? null : hash(old) });
    }
    if (!changed.length || changed.length > MAX_FILES) return NextResponse.json({ error: 'Final draft must contain 1–10 changed files', diagnostic, repairs }, { status: 422 });
    const acceptance = analyzeGeneratedProject(Array.from(working.entries()).map(([filePath, content]) => ({ path: filePath, content })), body.requirements);
    acceptance.requirements = acceptance.requirements.map((item, index) => {
      const evidence = diagnostic.requirementEvidence?.[index];
      return evidence ? { ...item, status: evidence.status, evidence: evidence.method + ': ' + evidence.evidence } : item;
    });
    if (acceptance.requirements.some(item => item.status === 'fail')) acceptance.status = 'fail';
    const verificationProof = diagnostic.ok ? issueVerificationProof(body.projectId, changed) : null;
    return NextResponse.json({ ok: diagnostic.ok, verificationProof, commandChecks, summary: diagnostic.ok ? 'Isolated browser smoke test and applicable project commands passed; inspect the acceptance report for requirements that remain unverified.' : 'Verification ended with failures; inspect browser and command diagnostics before applying.', diagnostic, repairs, acceptance,
      build: { summary: 'Draft checked by the sandbox smoke test; not applied to the real project.', plan: repairs.map(x => 'Repair round ' + x.round + ': ' + x.summary), requirements: Array.isArray(body.requirements) ? body.requirements.filter((item): item is string => typeof item === 'string').slice(0, 20) : [], files: changed }, appliedToProject: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI verify/repair failed' }, { status: 400 });
  } finally { if (root) fs.rmSync(root, { recursive: true, force: true }); }
}
