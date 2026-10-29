export const runtime = 'nodejs';

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getProject } from '@/lib/project-store';
import { listProjectFiles, readProjectFile } from '@/lib/files';
import { resolveProjectPath } from '@/lib/path-security';
import { assertLocalMutation } from '@/lib/path-security';
import { checkRateLimit } from '@/lib/rate-limit';
import { estimateAICostUsd, recordAIUsage } from '@/lib/ai-usage';
import { readJsonBody } from '@/lib/request-body';
import { extractAIResponseText } from '@/lib/ai-response';
import { isProtectedAIGeneratedPath } from '@/lib/ai-path-policy';

const MAX_BODY_BYTES = 24 * 1024;
const MAX_PROMPT_CHARS = 12_000;
const MAX_CONTEXT_BYTES = 48 * 1024;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 256 * 1024;

type ProposedFile = { path: string; content: string; baseHash: string | null };
function hash(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
function parseBuild(output: string, projectId: string, originals: Map<string, string>) {
  const text = output.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '');
  const value = JSON.parse(text) as { summary?: unknown; plan?: unknown; requirements?: unknown; files?: unknown };
  if (typeof value.summary !== 'string' || !value.summary.trim() ||
      !Array.isArray(value.plan) || value.plan.length < 1 || value.plan.length > 12 ||
      value.plan.some((step) => typeof step !== 'string' || !step.trim() || step.length > 500) ||
      !Array.isArray(value.requirements) || value.requirements.length < 1 || value.requirements.length > 20 ||
      value.requirements.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500) ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_FILES) {
    throw new Error('AI returned an invalid build plan');
  }
  const seen = new Set<string>();
  const files: ProposedFile[] = value.files.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('AI returned an invalid file change');
    const file = item as { path?: unknown; content?: unknown };
    if (typeof file.path !== 'string' || typeof file.content !== 'string' ||
        file.content.includes('\0') || Buffer.byteLength(file.content, 'utf8') > MAX_FILE_BYTES) {
      throw new Error('AI returned an invalid file path or oversized file');
    }
    const normalized = file.path.replace(/\\/g, '/');
    resolveProjectPath(projectId, normalized);
    if (normalized !== file.path || normalized !== normalized.trim() || seen.has(normalized)) throw new Error('AI returned duplicate or non-canonical paths');
    if (isProtectedAIGeneratedPath(normalized)) {
      throw new Error('AI attempted to modify a protected path');
    }
    seen.add(normalized);
    const previous = originals.get(normalized);
    return { path: normalized, content: file.content, baseHash: previous === undefined ? null : hash(previous) };
  });
  return { summary: value.summary.slice(0, 2000), plan: value.plan as string[], requirements: value.requirements as string[], files };
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  const rate = checkRateLimit('ai-build:' + new URL(request.url).host, 5, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: 'Build generation rate limit exceeded' }, {
    status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) },
  });
  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const input = body as { projectId?: unknown; prompt?: unknown; approved?: unknown };
  if (input.approved !== true) return NextResponse.json({ error: 'Explicit approval required before generation' }, { status: 409 });
  if (typeof input.projectId !== 'string' || typeof input.prompt !== 'string' ||
      !input.prompt.trim() || input.prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: 'projectId and prompt (1–12000 characters) are required' }, { status: 400 });
  }
  if (!getProject(input.projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const provider = process.env.AI_PROVIDER === 'ollama' ? 'ollama' : process.env.AI_PROVIDER === 'groq' ? 'groq' : 'openai';
  const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: provider === 'groq'
      ? 'Groq is selected but GROQ_API_KEY is not configured.'
      : 'No AI provider configured. Set AI_PROVIDER=ollama for a free local model, or configure OPENAI_API_KEY.' }, { status: 503 });
  }

  const originals = new Map<string, string>();
  let contextBytes = 0;
  const contextFiles: { path: string; content: string }[] = [];
  try {
    for (const entry of listProjectFiles(input.projectId).filter((item) => item.type === 'file').slice(0, 20)) {
      if (/(^|\/)(\.env[^/]*|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*)(\/|$)/i.test(entry.path)) continue;
      const content = readProjectFile(input.projectId, entry.path);
      const excerpt = content.slice(0, 8000);
      const bytes = Buffer.byteLength(excerpt, 'utf8');
      if (contextBytes + bytes > MAX_CONTEXT_BYTES) break;
      originals.set(entry.path, content);
      contextFiles.push({ path: entry.path, content: excerpt });
      contextBytes += bytes;
    }
  } catch {
    return NextResponse.json({ error: 'Could not safely read project context' }, { status: 400 });
  }

  const model = provider === 'ollama' ? (process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b')
    : provider === 'groq' ? (process.env.GROQ_MODEL || 'openai/gpt-oss-20b')
    : (process.env.OPENAI_MODEL || 'gpt-4.1-mini');
  const system = [
    'You are the implementation agent inside Alex Studio, a local-first project builder.',
    'Return only valid JSON with exactly this shape: {"summary":"...","plan":["..."],"requirements":["observable acceptance requirement 1","..."],"files":[{"path":"relative/path","content":"complete UTF-8 file content"}]}.',
    'Create a small, coherent implementation that satisfies the user request. First convert the user specification into 1–20 distinct, observable acceptance requirements, preserving all explicit constraints. Return complete file contents, not patches or markdown fences. Requirements are a checklist, not proof of completion.',
    'Use existing project files as context and preserve existing behavior unless the request requires changing it. Do not output secrets.',
    'Only use canonical relative paths. Never use absolute paths, dot-prefixed path segments, traversal, .env files, .git, .alex, or node_modules.',
    'Limit the proposal to 10 files and keep each file below 256 KiB. Do not claim tests were run; this endpoint only prepares a reviewable draft.',
    'Do not include shell commands, package install scripts, or instructions to execute generated code. Do not modify lockfiles.',
  ].join('\n');
  const user = JSON.stringify({
    request: input.prompt,
    currentProjectFiles: contextFiles,
    responseRequirements: { planSteps: '1–12', requirements: '1–20 observable acceptance requirements', files: '1–10', fullFileContents: true },
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider === 'ollama' ? 120_000 : 30_000);
  try {
    const response = provider === 'ollama'
      ? await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, stream: false,
            format: 'json',
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            options: { num_predict: 12000 },
          }),
        })
      : provider === 'groq'
        ? await fetch('https://api.groq.com/openai/v1/responses', {
            method: 'POST', signal: controller.signal,
            headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, instructions: system, input: user, max_output_tokens: 12000 }),
          })
        : await fetch('https://api.openai.com/v1/responses', {
            method: 'POST', signal: controller.signal,
            headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, instructions: system, input: user, max_output_tokens: 12000 }),
          });
    if (!response.ok) {
      let providerError: { error?: { type?: unknown; code?: unknown } } = {};
      try {
        providerError = await response.json() as { error?: { type?: unknown; code?: unknown } };
      } catch {
        // Keep provider error bodies private and treat malformed error payloads generically.
      }
      const errorCode = [providerError.error?.code, providerError.error?.type]
        .find((value): value is string => typeof value === 'string');
      const quotaExceeded = errorCode === 'insufficient_quota' || errorCode === 'billing_hard_limit_reached';
      const retryAfter = response.headers.get('retry-after');
      const headers: Record<string, string> = {};
      if (response.status === 429 && retryAfter && /^[0-9]{1,5}$/.test(retryAfter)) {
        headers['Retry-After'] = retryAfter;
      }
      return NextResponse.json({
        error: quotaExceeded
          ? provider === 'groq' ? 'Groq quota or rate limit reached; check your Groq plan limits' : 'AI provider quota or billing limit reached; check OpenAI project usage and billing'
          : response.status === 429
            ? 'AI provider is busy; try again later'
            : 'AI provider request failed',
      }, {
        status: response.status === 429 ? 503 : 502,
        headers,
      });
    }
    const rawResult = await response.json() as {
      output_text?: unknown;
      output?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
      message?: { content?: unknown };
      prompt_eval_count?: unknown;
      eval_count?: unknown;
    };
    const result = provider === 'ollama'
      ? {
          output_text: extractAIResponseText(rawResult),
          usage: {
            input_tokens: rawResult.prompt_eval_count,
            output_tokens: rawResult.eval_count,
          },
        }
      : { output_text: extractAIResponseText(rawResult), usage: rawResult.usage };
    if (typeof result.output_text !== 'string') return NextResponse.json({ error: 'AI provider returned an invalid response' }, { status: 502 });
    const inputTokens = Number.isInteger(result.usage?.input_tokens) ? result.usage?.input_tokens as number : null;
    const outputTokens = Number.isInteger(result.usage?.output_tokens) ? result.usage?.output_tokens as number : null;
    const estimatedCostUsd = provider === 'ollama' ? 0 : provider === 'groq' ? null : estimateAICostUsd(inputTokens, outputTokens);
    let accounting: { monthlyCostUsd: number | null; budgetWarning: boolean };
    try {
      accounting = recordAIUsage(input.projectId, { timestamp: new Date().toISOString(), model, inputTokens, outputTokens, estimatedCostUsd });
    } catch {
      return NextResponse.json({ error: 'AI usage could not be recorded; draft withheld' }, { status: 500 });
    }
    let build;
    try { build = parseBuild(result.output_text, input.projectId, originals); }
    catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'AI returned invalid project files' }, { status: 502 });
    }
    return NextResponse.json({ build, usage: { inputTokens, outputTokens, estimatedCostUsd, ...accounting } }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json({ error: timedOut ? 'AI provider timed out' : 'AI provider is unavailable' }, { status: 504 });
  } finally { clearTimeout(timeout); }
}
