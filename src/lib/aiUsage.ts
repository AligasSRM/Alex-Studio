import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureWorkspace } from "./fileOps.ts";

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
  estimatedRequests: number;
}

interface Reservation {
  projectId: string;
  month: string;
  reservedUsd: number;
  createdAt: number;
}

interface Ledger {
  version: 1;
  months: Record<string, Record<string, UsageTotals>>;
  reservations: Record<string, Reservation>;
}

export interface BudgetConfig {
  monthlyLimitUsd: number;
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
}

export interface UsageSummary {
  month: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  monthlyLimitUsd: number;
  remainingUsd: number;
  requests: number;
  usageEstimated: boolean;
}

const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");
const INTERNAL_DIR = path.join(WORKSPACE_ROOT, ".alex");
const LEDGER_PATH = path.join(INTERNAL_DIR, "ai-usage.json");
const LOCK_PATH = path.join(INTERNAL_DIR, "ai-usage.lock");

function readNumber(name: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`AI_BUDGET_CONFIG_INVALID:${name}`);
  return parsed;
}

export function getBudgetConfig(): BudgetConfig {
  const monthlyLimitUsd = readNumber("AI_MONTHLY_LIMIT_USD", process.env.AI_MONTHLY_LIMIT_USD ?? "5");
  const inputCostPerMillionUsd = readNumber("AI_INPUT_COST_PER_1M_USD", process.env.AI_INPUT_COST_PER_1M_USD);
  const outputCostPerMillionUsd = readNumber("AI_OUTPUT_COST_PER_1M_USD", process.env.AI_OUTPUT_COST_PER_1M_USD);
  if (monthlyLimitUsd <= 0 || (inputCostPerMillionUsd === 0 && outputCostPerMillionUsd === 0)) {
    throw new Error("AI_BUDGET_CONFIG_INVALID:prices_and_limit_must_be_positive");
  }
  return { monthlyLimitUsd, inputCostPerMillionUsd, outputCostPerMillionUsd };
}

function costFor(inputTokens: number, outputTokens: number, config: BudgetConfig): number {
  return (inputTokens * config.inputCostPerMillionUsd + outputTokens * config.outputCostPerMillionUsd) / 1_000_000;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function emptyLedger(): Ledger {
  return { version: 1, months: {}, reservations: {} };
}

function readLedger(): Ledger {
  ensureWorkspace();
  fs.mkdirSync(INTERNAL_DIR, { recursive: true });
  if (fs.lstatSync(INTERNAL_DIR).isSymbolicLink()) throw new Error("AI_USAGE_LEDGER_INVALID:internal_directory_symlink");
  if (!fs.existsSync(LEDGER_PATH)) return emptyLedger();

  try {
    const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as Ledger;
    if (parsed.version !== 1 || !parsed.months || !parsed.reservations) {
      throw new Error("Invalid ledger schema");
    }
    return parsed;
  } catch {
    throw new Error("AI_USAGE_LEDGER_INVALID");
  }
}

function writeLedger(ledger: Ledger): void {
  const temporaryPath = path.join(INTERNAL_DIR, `ai-usage.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(ledger, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, LEDGER_PATH);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

async function acquireLock(): Promise<() => void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(LOCK_PATH, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return () => {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        try { fs.unlinkSync(LOCK_PATH); } catch { /* lock already removed */ }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > 30_000) {
          fs.unlinkSync(LOCK_PATH);
          continue;
        }
      } catch {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("AI_USAGE_LOCK_TIMEOUT");
}

async function withLock<T>(operation: () => T | Promise<T>): Promise<T> {
  const release = await acquireLock();
  try {
    return await operation();
  } finally {
    release();
  }
}

function projectTotals(ledger: Ledger, month: string, projectId: string): UsageTotals {
  return ledger.months[month]?.[projectId] ?? {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    requests: 0,
    estimatedRequests: 0,
  };
}

export async function reserveAiUsage(
  projectId: string,
  conservativeInputTokens: number,
  maxOutputTokens: number,
  config: BudgetConfig
): Promise<{ reservationId: string; reservedUsd: number; month: string }> {
  const month = currentMonth();
  const reservedUsd = costFor(conservativeInputTokens, maxOutputTokens, config);

  return withLock(() => {
    const ledger = readLedger();
    const totals = projectTotals(ledger, month, projectId);
    const otherReservations = Object.values(ledger.reservations)
      .filter((reservation) => reservation.month === month && reservation.projectId === projectId)
      .reduce((sum, reservation) => sum + reservation.reservedUsd, 0);

    if (totals.costUsd + otherReservations + reservedUsd > config.monthlyLimitUsd) {
      throw new Error("AI_BUDGET_EXCEEDED");
    }

    const reservationId = randomUUID();
    ledger.reservations[reservationId] = {
      projectId,
      month,
      reservedUsd,
      createdAt: Date.now(),
    };
    writeLedger(ledger);
    return { reservationId, reservedUsd, month };
  });
}

export async function settleAiUsage(
  reservationId: string,
  inputTokens: number,
  outputTokens: number,
  usageEstimated: boolean,
  config: BudgetConfig
): Promise<UsageSummary> {
  return withLock(() => {
    const ledger = readLedger();
    const reservation = ledger.reservations[reservationId];
    if (!reservation) throw new Error("AI_USAGE_RESERVATION_NOT_FOUND");

    const totals = projectTotals(ledger, reservation.month, reservation.projectId);
    const actualCost = costFor(inputTokens, outputTokens, config);
    delete ledger.reservations[reservationId];
    ledger.months[reservation.month] ??= {};
    ledger.months[reservation.month][reservation.projectId] = {
      inputTokens: totals.inputTokens + inputTokens,
      outputTokens: totals.outputTokens + outputTokens,
      costUsd: totals.costUsd + actualCost,
      requests: totals.requests + 1,
      estimatedRequests: totals.estimatedRequests + (usageEstimated ? 1 : 0),
    };
    writeLedger(ledger);

    return {
      month: reservation.month,
      inputTokens,
      outputTokens,
      costUsd: actualCost,
      monthlyLimitUsd: config.monthlyLimitUsd,
      remainingUsd: Math.max(0, config.monthlyLimitUsd - (totals.costUsd + actualCost)),
      requests: totals.requests + 1,
      usageEstimated,
    };
  });
}

export async function releaseAiUsage(reservationId: string): Promise<void> {
  await withLock(() => {
    const ledger = readLedger();
    if (ledger.reservations[reservationId]) {
      delete ledger.reservations[reservationId];
      writeLedger(ledger);
    }
  });
}
