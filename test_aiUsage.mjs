import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { reserveAiUsage, settleAiUsage } from "./src/lib/aiUsage.ts";

test("AI budget reservation blocks a request that would exceed the project limit", async () => {
  const projectId = `budget-test-${randomUUID()}`;
  const config = { monthlyLimitUsd: 0.001, inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 1 };
  await assert.rejects(
    reserveAiUsage(projectId, 1000, 2000, config),
    /AI_BUDGET_EXCEEDED/
  );
});

test("AI usage settlement records actual token cost and remaining budget", async () => {
  const projectId = `usage-test-${randomUUID()}`;
  const config = { monthlyLimitUsd: 1, inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 2 };
  const reservation = await reserveAiUsage(projectId, 1000, 2000, config);
  const usage = await settleAiUsage(reservation.reservationId, 500, 1000, false, config);

  assert.equal(usage.inputTokens, 500);
  assert.equal(usage.outputTokens, 1000);
  assert.equal(usage.costUsd, 0.0025);
  assert.equal(usage.monthlyLimitUsd, 1);
  assert.equal(usage.remainingUsd, 0.9975);
  assert.equal(usage.usageEstimated, false);
});
