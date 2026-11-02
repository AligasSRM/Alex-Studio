export const runtime = 'nodejs';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation, resolveProjectPath } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { listProjectFiles, readProjectFile } from '@/lib/files';
import { checkRateLimit } from '@/lib/rate-limit';
import { estimateAICostUsd, recordAIUsage } from '@/lib/ai-usage';
import { analyzeGeneratedProject } from '@/lib/ai-acceptance';
import { evaluateRequirements, parseBrowserSnapshot, type RequirementEvidence } from '@/lib/ai-requirement-evidence';
import { issueVerificationProof } from '@/lib/ai-verification-proof';
import { runProjectCommands, inspectGeneratedProject, type CommandRun } from '@/lib/ai-command-runner';
import { runBuildServerPreview } from '@/lib/ai-build-server-preview';
import { readJsonBody } from '@/lib/request-body';
import { extractAIResponseText } from '@/lib/ai-response';
import { isProtectedAIGeneratedPath } from '@/lib/ai-path-policy';
import { findSecretKinds, redactSecretMaterial } from '@/lib/secret-scanner';
import { filterSandboxFiles } from '@/lib/ai-sandbox-files';

const MAX_FILES = 10;
const MAX_ROUNDS = 2;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const SENSITIVE_PATH = /(^|\/)(\.env[^/]*|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*|node_modules|\.git|\.alex)(\/|$)/i;
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

function safePath(projectId: string, value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid AI file path');
  const normalized = value.replace(/\\/g, '/');
  resolveProjectPath(projectId, normalized);
  if (normalized !== value || normalized !== normalized.trim() || isProtectedAIGeneratedPath(normalized)) {
    throw new Error('Protected or non-canonical path denied');
  }
  return normalized;
}
function parseDraft(projectId: string, input: unknown, current: Map<string, string>, checkHash: boolean, secretPaths: Set<string> = new Set()): FileDraft[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_FILES) throw new Error('Invalid file batch');
  const seen = new Set<string>();
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid file change');
    const item = raw as { path?: unknown; content?: unknown; baseHash?: unknown };
    const filePath = safePath(projectId, item.path);
    if (typeof item.content !== 'string' || item.content.includes('\0') || Buffer.byteLength(item.content, 'utf8') > 262144) throw new Error('Invalid or oversized file');
    if (seen.has(filePath)) throw new Error('Duplicate path');
    if (secretPaths.has(filePath)) throw new Error('AI attempted to modify a file containing secret-like material');
    const secretKinds = findSecretKinds(item.content);
    if (secretKinds.length) throw new Error('AI generated secret-like material (' + secretKinds.join(', ') + '); repair withheld');
    seen.add(filePath);
    const old = current.get(filePath);
    const expected = old === undefined ? null : hash(old);
    if (checkHash && item.baseHash !== expected) throw new Error('Stale draft; generate a fresh draft');
    return { path: filePath, content: item.content, baseHash: expected };
  });
}
export function runSandbox(_root: string): Promise<Result> {
  return Promise.resolve({
    ok: false,
    available: false,
    summary: 'Windows-native isolated browser runner is not implemented',
    output: 'Browser verification is unavailable. The former Docker/Linux runner was removed from the approved platform scope. No generated browser code was started; direct host execution is prohibited.',
    pageSnapshot: null,
  });
}
async function getRepair(apiKey: string | undefined, model: string, provider: 'openai' | 'groq' | 'ollama', projectId: string, prompt: string, files: { path: string; content: string }[], result: Result, current: Map<string, string>, secretPaths: Set<string>) {
  const instructions = 'Repair the supplied static HTML/CSS/JS project using the isolated browser diagnostics. Return only JSON: {"summary":"...","files":[{"path":"relative/path","content":"complete file content"}]}. Maximum 10 files, each under 256 KiB. Use canonical relative paths only. Never change hidden paths, secrets, node_modules, .git, .alex or lockfiles. Do not include host shell commands. Do not claim tests passed unless diagnostics prove it.';
  const safeDiagnostics = JSON.parse(JSON.stringify(result, (_key, value) => typeof value === 'string' ? redactSecretMaterial(value) : value)) as Result;
  const input = JSON.stringify({ request: redactSecretMaterial(prompt), diagnostics: safeDiagnostics, files });
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
  const filesOut = parseDraft(projectId, parsed.files, current, false, secretPaths);
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
    const originals = new Map<string, string>(); const working = new Map<string, string>(); const secretPaths = new Set<string>(); let total = 0;
    for (const entry of listProjectFiles(body.projectId).filter(x => x.type === 'file')) {
      if (SENSITIVE_PATH.test(entry.path)) continue;
      const content = readProjectFile(body.projectId, entry.path); total += Buffer.byteLength(content, 'utf8');
      if (total > 5 * 1024 * 1024) throw new Error('Project exceeds 5 MiB sandbox limit');
      originals.set(entry.path, content); working.set(entry.path, content);
      if (findSecretKinds(content).length) secretPaths.add(entry.path);
    }
    for (const file of parseDraft(body.projectId, body.files, originals, true, secretPaths)) working.set(file.path, file.content);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-studio-ai-')); fs.chmodSync(root, 0o755);
    const writeFiles = () => {
      for (const [filePath, content] of Array.from(filterSandboxFiles(working, secretPaths).entries())) {
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
        if (SENSITIVE_PATH.test(filePath) || secretPaths.has(filePath)) continue;
        const excerpt = content.slice(0, 8000); bytes += Buffer.byteLength(excerpt, 'utf8');
        if (bytes > 48 * 1024) break; context.push({ path: filePath, content: excerpt });
      }
      let next;
      try { next = await getRepair(apiKey, model, provider, body.projectId, body.prompt, context, diagnostic, working, secretPaths); }
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
    return NextResponse.json({ ok: diagnostic.ok, verificationProof, commandChecks, summary: diagnostic.ok ? 'Isolated build/server preview or static browser verification and applicable project commands passed; inspect the acceptance report for requirements that remain unverified.' : 'Verification ended with failures; inspect browser and command diagnostics before applying.', diagnostic, repairs, acceptance,
      build: { summary: 'Draft checked by the isolated static browser runner or the build/server preview runner; not applied to the real project.', plan: repairs.map(x => 'Repair round ' + x.round + ': ' + x.summary), requirements: Array.isArray(body.requirements) ? body.requirements.filter((item): item is string => typeof item === 'string').slice(0, 20) : [], files: changed }, appliedToProject: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI verify/repair failed' }, { status: 400 });
  } finally { if (root) fs.rmSync(root, { recursive: true, force: true }); }
}
