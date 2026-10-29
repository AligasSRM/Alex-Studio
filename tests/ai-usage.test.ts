import fs from 'node:fs';
import path from 'node:path';
import { estimateAICostUsd, recordAIUsage, type AIUsageEntry } from '../lib/ai-usage';
import { projectRoot } from '../lib/path-security';

const originalInputRate = process.env.AI_INPUT_USD_PER_1M_TOKENS;
const originalOutputRate = process.env.AI_OUTPUT_USD_PER_1M_TOKENS;
const originalWarning = process.env.AI_MONTHLY_WARNING_USD;
const ids: string[] = [];

function makeProject() {
  const id = 'usage-test-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  ids.push(id);
  fs.mkdirSync(projectRoot(id), { recursive: true });
  return id;
}

function entry(overrides: Partial<AIUsageEntry> = {}): AIUsageEntry {
  return {
    timestamp: '2026-10-15T12:00:00.000Z',
    model: 'test-model',
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.25,
    ...overrides,
  };
}

afterEach(() => {
  for (const id of ids.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  if (originalInputRate === undefined) delete process.env.AI_INPUT_USD_PER_1M_TOKENS;
  else process.env.AI_INPUT_USD_PER_1M_TOKENS = originalInputRate;
  if (originalOutputRate === undefined) delete process.env.AI_OUTPUT_USD_PER_1M_TOKENS;
  else process.env.AI_OUTPUT_USD_PER_1M_TOKENS = originalOutputRate;
  if (originalWarning === undefined) delete process.env.AI_MONTHLY_WARNING_USD;
  else process.env.AI_MONTHLY_WARNING_USD = originalWarning;
});

describe('AI usage and cost accounting', () => {
  it('estimates token cost only when both valid rates and token counts are available', () => {
    process.env.AI_INPUT_USD_PER_1M_TOKENS = '2';
    process.env.AI_OUTPUT_USD_PER_1M_TOKENS = '8';
    expect(estimateAICostUsd(100_000, 50_000)).toBe(0.6);
    expect(estimateAICostUsd(null, 50)).toBeNull();
    process.env.AI_OUTPUT_USD_PER_1M_TOKENS = '-1';
    expect(estimateAICostUsd(100, 50)).toBeNull();
    delete process.env.AI_OUTPUT_USD_PER_1M_TOKENS;
    expect(estimateAICostUsd(100, 50)).toBeNull();
  });

  it('aggregates only the current entry month and raises the configured warning at the threshold', () => {
    const id = makeProject();
    process.env.AI_MONTHLY_WARNING_USD = '0.50';
    recordAIUsage(id, entry({ timestamp: '2026-09-30T23:59:59.000Z', estimatedCostUsd: 10 }));
    const first = recordAIUsage(id, entry({ estimatedCostUsd: 0.25 }));
    expect(first).toEqual({ monthlyCostUsd: 0.25, budgetWarning: false });
    const second = recordAIUsage(id, entry({ timestamp: '2026-10-29T12:00:00.000Z', estimatedCostUsd: 0.25 }));
    expect(second).toEqual({ monthlyCostUsd: 0.5, budgetWarning: true });
  });

  it('does not claim a complete monthly cost when any entry lacks pricing data', () => {
    const id = makeProject();
    process.env.AI_MONTHLY_WARNING_USD = '0.01';
    recordAIUsage(id, entry({ estimatedCostUsd: null }));
    const result = recordAIUsage(id, entry({ estimatedCostUsd: 0.5 }));
    expect(result).toEqual({ monthlyCostUsd: null, budgetWarning: false });
  });

  it('rejects a symlinked usage ledger rather than following it', () => {
    const id = makeProject();
    const directory = path.join(projectRoot(id), '.alex');
    fs.mkdirSync(directory, { recursive: true });
    const outside = path.join(projectRoot(id), 'outside-ledger.json');
    fs.writeFileSync(outside, '[]');
    fs.symlinkSync(outside, path.join(directory, 'ai-usage.json'));
    expect(() => recordAIUsage(id, entry())).toThrow('Usage ledger must be a regular file');
  });
});
