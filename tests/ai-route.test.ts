import fs from 'node:fs';
import path from 'node:path';
import { POST } from '../app/api/ai/generate/route';
import { POST as createProjectRoute } from '../app/api/projects/route';
import { projectRoot } from '../lib/path-security';
import { checkRateLimit, resetRateLimitsForTests } from '../lib/rate-limit';
import { estimateAICostUsd } from '../lib/ai-usage';

const createdIds: string[] = [];
const env = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, provider: process.env.AI_PROVIDER, groqKey: process.env.GROQ_API_KEY, groqModel: process.env.GROQ_MODEL, input: process.env.AI_INPUT_USD_PER_1M_TOKENS, output: process.env.AI_OUTPUT_USD_PER_1M_TOKENS, warning: process.env.AI_MONTHLY_WARNING_USD };
function localPost(url: string, body: string) {
  return new Request(url, { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' }, body });
}
async function makeProject() {
  const response = await createProjectRoute(localPost('http://localhost:3000/api/projects', JSON.stringify({ name: 'AI Route Test ' + Date.now() })));
  const data = await response.json() as { project: { id: string } };
  createdIds.push(data.project.id);
  return data.project.id;
}
afterEach(() => {
  jest.restoreAllMocks();
  resetRateLimitsForTests();
  for (const id of createdIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  if (env.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = env.key;
  if (env.model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = env.model;
  if (env.provider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = env.provider;
  if (env.groqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = env.groqKey;
  if (env.groqModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = env.groqModel;
  if (env.input === undefined) delete process.env.AI_INPUT_USD_PER_1M_TOKENS; else process.env.AI_INPUT_USD_PER_1M_TOKENS = env.input;
  if (env.output === undefined) delete process.env.AI_OUTPUT_USD_PER_1M_TOKENS; else process.env.AI_OUTPUT_USD_PER_1M_TOKENS = env.output;
  if (env.warning === undefined) delete process.env.AI_MONTHLY_WARNING_USD; else process.env.AI_MONTHLY_WARNING_USD = env.warning;
});

describe('AI generation endpoint', () => {
  it('requires explicit approval before provider access', async () => {
    const id = await makeProject();
    const response = await POST(localPost('http://localhost:3000/api/ai/generate', JSON.stringify({ projectId: id, prompt: 'hello' })));
    expect(response.status).toBe(409);
  });
  it('returns configuration error without a server API key', async () => {
    const id = await makeProject();
    delete process.env.OPENAI_API_KEY;
    const response = await POST(localPost('http://localhost:3000/api/ai/generate', JSON.stringify({ projectId: id, prompt: 'hello', approved: true })));
    expect(response.status).toBe(503);
  });
  it('rejects malformed JSON and oversized requests', async () => {
    const malformed = await POST(localPost('http://localhost:3000/api/ai/generate', '{'));
    expect(malformed.status).toBe(400);
    const oversized = await POST(localPost('http://localhost:3000/api/ai/generate', JSON.stringify({ prompt: 'x'.repeat(25_000) })));
    expect(oversized.status).toBe(413);
  });
  it('rate limits requests with deterministic window behavior', () => {
    expect(checkRateLimit('test', 1, 100, 1000).allowed).toBe(true);
    expect(checkRateLimit('test', 1, 100, 1050).allowed).toBe(false);
    expect(checkRateLimit('test', 1, 100, 1100).allowed).toBe(true);
  });
  it('uses Groq for text generation without requiring an OpenAI key', async () => {
    const id = await makeProject();
    delete process.env.OPENAI_API_KEY;
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'test-groq-secret';
    process.env.GROQ_MODEL = 'openai/gpt-oss-20b';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: 'Groq suggestion',
      usage: { input_tokens: 17, output_tokens: 29 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await POST(localPost('http://localhost:3000/api/ai/generate', JSON.stringify({
      projectId: id, prompt: 'Suggest a change', approved: true,
    })));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://api.groq.com/openai/v1/responses', expect.objectContaining({
      headers: { Authorization: 'Bearer test-groq-secret', 'Content-Type': 'application/json' },
    }));
    const data = await response.json() as { output: string; usage: { estimatedCostUsd: number | null } };
    expect(data.output).toBe('Groq suggestion');
    expect(data.usage.estimatedCostUsd).toBeNull();
    expect(JSON.stringify(data)).not.toContain('test-groq-secret');
  });

  it('estimates cost only when explicit pricing rates are configured', () => {
    process.env.AI_INPUT_USD_PER_1M_TOKENS = '2';
    process.env.AI_OUTPUT_USD_PER_1M_TOKENS = '8';
    expect(estimateAICostUsd(1000, 1000)).toBe(0.01);
    delete process.env.AI_INPUT_USD_PER_1M_TOKENS;
    expect(estimateAICostUsd(1000, 1000)).toBeNull();
  });
  it('keeps provider keys server-side and records usage on successful mocked response', async () => {
    const id = await makeProject();
    process.env.OPENAI_API_KEY = 'test-server-secret';
    process.env.AI_INPUT_USD_PER_1M_TOKENS = '2';
    process.env.AI_OUTPUT_USD_PER_1M_TOKENS = '8';
    process.env.AI_MONTHLY_WARNING_USD = '0.001';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: 'Suggested change', usage: { input_tokens: 1000, output_tokens: 1000 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await POST(localPost('http://localhost:3000/api/ai/generate', JSON.stringify({ projectId: id, prompt: 'Suggest a change', approved: true })));
    expect(response.status).toBe(200);
    const data = await response.json() as { output: string; usage: { estimatedCostUsd: number; budgetWarning: boolean } };
    expect(data.output).toBe('Suggested change');
    expect(data.usage.estimatedCostUsd).toBe(0.01);
    expect(data.usage.budgetWarning).toBe(true);
    const ledger = path.join(projectRoot(id), '.alex', 'ai-usage.json');
    expect(fs.existsSync(ledger)).toBe(true);
    expect(fs.readFileSync(ledger, 'utf8')).not.toContain('test-server-secret');
  });
});
