import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './path-security';

export type AIUsageEntry = {
  timestamp: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

function usagePath(projectId: string) {
  return path.join(projectRoot(projectId), '.alex', 'ai-usage.json');
}

export function recordAIUsage(projectId: string, entry: AIUsageEntry) {
  const file = usagePath(projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let entries: AIUsageEntry[] = [];
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Usage ledger must be a regular file');
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('Usage ledger is invalid');
    entries = parsed as AIUsageEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  entries.push(entry);
  const temporary = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  const month = entry.timestamp.slice(0, 7);
  const monthlyCostUsd = entries
    .filter((item) => item.timestamp.slice(0, 7) === month)
    .reduce((sum, item) => sum + (typeof item.estimatedCostUsd === 'number' ? item.estimatedCostUsd : 0), 0);
  const warningAt = Number(process.env.AI_MONTHLY_WARNING_USD);
  return {
    monthlyCostUsd: Number(monthlyCostUsd.toFixed(6)),
    budgetWarning: Number.isFinite(warningAt) && warningAt > 0 && monthlyCostUsd >= warningAt,
  };
}

export function estimateAICostUsd(inputTokens: number | null, outputTokens: number | null) {
  const inputRate = Number(process.env.AI_INPUT_USD_PER_1M_TOKENS);
  const outputRate = Number(process.env.AI_OUTPUT_USD_PER_1M_TOKENS);
  if (inputTokens === null || outputTokens === null ||
      !Number.isFinite(inputRate) || inputRate < 0 ||
      !Number.isFinite(outputRate) || outputRate < 0 ||
      process.env.AI_INPUT_USD_PER_1M_TOKENS === undefined ||
      process.env.AI_OUTPUT_USD_PER_1M_TOKENS === undefined) return null;
  return Number(((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000).toFixed(8));
}
