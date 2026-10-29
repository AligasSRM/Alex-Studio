import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot } from './path-security';

export type AIUsageEntry = {
  timestamp: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

const MAX_USAGE_LEDGER_BYTES = 4 * 1024 * 1024;
const MAX_USAGE_ENTRIES = 20_000;

function usageDirectory(projectId: string) {
  const root = projectRoot(projectId);
  const directory = path.join(root, '.alex');
  try {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Usage metadata directory must be a real directory');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  }
  fs.chmodSync(directory, 0o700);
  return directory;
}

function isUsageEntry(value: unknown): value is AIUsageEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AIUsageEntry>;
  const validCount = (count: unknown) => count === null ||
    (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0);
  return typeof entry.timestamp === 'string' && !Number.isNaN(Date.parse(entry.timestamp)) &&
    typeof entry.model === 'string' && entry.model.length > 0 &&
    validCount(entry.inputTokens) && validCount(entry.outputTokens) &&
    (entry.estimatedCostUsd === null ||
      (typeof entry.estimatedCostUsd === 'number' && Number.isFinite(entry.estimatedCostUsd) && entry.estimatedCostUsd >= 0));
}

export function recordAIUsage(projectId: string, entry: AIUsageEntry) {
  if (!isUsageEntry(entry)) throw new Error('Invalid AI usage entry');
  const directory = usageDirectory(projectId);
  const file = path.join(directory, 'ai-usage.json');
  let entries: AIUsageEntry[] = [];
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Usage ledger must be a regular file');
    if (stat.size > MAX_USAGE_LEDGER_BYTES) throw new Error('Usage ledger exceeds the safe storage limit');
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed) || !parsed.every(isUsageEntry)) throw new Error('Usage ledger is invalid');
    if (parsed.length > MAX_USAGE_ENTRIES) throw new Error('Usage ledger exceeds the safe entry limit');
    entries = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (entries.length >= MAX_USAGE_ENTRIES) throw new Error('Usage ledger exceeds the safe entry limit');
  const nextEntries = [...entries, entry];
  const serialized = JSON.stringify(nextEntries, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_USAGE_LEDGER_BYTES) {
    throw new Error('Usage ledger exceeds the safe storage limit');
  }

  const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0);
  const descriptor = fs.openSync(temporary, flags, 0o600);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('Usage temporary file must be regular');
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }

  const month = entry.timestamp.slice(0, 7);
  const monthlyEntries = nextEntries.filter((item) => item.timestamp.slice(0, 7) === month);
  const hasCompleteCostData = monthlyEntries.every((item) => typeof item.estimatedCostUsd === 'number');
  const monthlyCostUsd = hasCompleteCostData
    ? monthlyEntries.reduce((sum, item) => sum + (item.estimatedCostUsd as number), 0)
    : null;
  const warningAt = Number(process.env.AI_MONTHLY_WARNING_USD);
  return {
    monthlyCostUsd: monthlyCostUsd === null ? null : Number(monthlyCostUsd.toFixed(6)),
    budgetWarning: monthlyCostUsd !== null && Number.isFinite(warningAt) && warningAt > 0 && monthlyCostUsd >= warningAt,
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
