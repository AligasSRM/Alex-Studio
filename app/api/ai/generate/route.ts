export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getProject } from '@/lib/project-store';
import { assertLocalMutation } from '@/lib/path-security';
import { checkRateLimit } from '@/lib/rate-limit';
import { estimateAICostUsd, recordAIUsage } from '@/lib/ai-usage';

const MAX_BODY_BYTES = 24 * 1024;
const MAX_PROMPT_CHARS = 20_000;

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) {
    return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  const rate = checkRateLimit('ai:' + new URL(request.url).host, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) },
    });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const input = body as { projectId?: unknown; prompt?: unknown; approved?: unknown };
  if (input.approved !== true) {
    return NextResponse.json({ error: 'Explicit approval required' }, { status: 409 });
  }
  if (typeof input.projectId !== 'string' || typeof input.prompt !== 'string' ||
      !input.prompt.trim() || input.prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: 'projectId and prompt (1–20000 characters) are required' }, { status: 400 });
  }
  if (!getProject(input.projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const provider = process.env.AI_PROVIDER === 'groq' ? 'groq' : 'openai';
  const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: provider === 'groq' ? 'Groq is selected but GROQ_API_KEY is not configured.' : 'AI provider is not configured on this server' }, { status: 503 });
  }

  const model = provider === 'groq' ? (process.env.GROQ_MODEL || 'openai/gpt-oss-20b') : (process.env.OPENAI_MODEL || 'gpt-4.1-mini');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(provider === 'groq' ? 'https://api.groq.com/openai/v1/responses' : 'https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: input.prompt, max_output_tokens: 4000 }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: response.status === 429 ? 'AI provider is busy; try again later' : 'AI provider request failed' }, {
        status: response.status === 429 ? 503 : 502,
      });
    }
    const result = await response.json() as {
      output_text?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    if (typeof result.output_text !== 'string') {
      return NextResponse.json({ error: 'AI provider returned an invalid response' }, { status: 502 });
    }
    const inputTokens = Number.isInteger(result.usage?.input_tokens) ? result.usage?.input_tokens as number : null;
    const outputTokens = Number.isInteger(result.usage?.output_tokens) ? result.usage?.output_tokens as number : null;
    const estimatedCostUsd = provider === 'groq' ? null : estimateAICostUsd(inputTokens, outputTokens);
    let accounting: { monthlyCostUsd: number | null; budgetWarning: boolean };
    try {
      accounting = recordAIUsage(input.projectId, {
        timestamp: new Date().toISOString(), model, inputTokens, outputTokens, estimatedCostUsd,
      });
    } catch {
      return NextResponse.json({ error: 'AI usage could not be recorded; response withheld' }, { status: 500 });
    }
    return NextResponse.json({
      output: result.output_text,
      usage: { inputTokens, outputTokens, estimatedCostUsd, ...accounting },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json({ error: timedOut ? 'AI provider timed out' : 'AI provider is unavailable' }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
