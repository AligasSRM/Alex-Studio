import { NextRequest, NextResponse } from "next/server";
import { chatWithAI, type ChatMessage } from "@/lib/aiClient";
import { projectExists } from "@/lib/projectOps";
import { getBudgetConfig, reserveAiUsage, settleAiUsage, releaseAiUsage } from "@/lib/aiUsage";

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 60_000;
const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const requestWindows = new Map<string, number[]>();

function isRateLimited(projectId: string): boolean {
  const now = Date.now();
  const recent = (requestWindows.get(projectId) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 10) {
    requestWindows.set(projectId, recent);
    return true;
  }
  recent.push(now);
  requestWindows.set(projectId, recent);
  return false;
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 256_000) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const { messages, projectId } = body as { messages?: unknown; projectId?: unknown };
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId) || !projectExists(projectId)) {
    return NextResponse.json({ error: "A valid projectId is required for project-scoped AI usage tracking" }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Messages array is required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: `At most ${MAX_MESSAGES} messages are allowed` }, { status: 400 });
  }

  let totalChars = 0;
  const validatedMessages: ChatMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return NextResponse.json({ error: "Each message must be an object" }, { status: 400 });
    }
    const item = message as { role?: unknown; content?: unknown };
    if (item.role !== "user" && item.role !== "assistant") {
      return NextResponse.json({ error: "Only user and assistant message roles are accepted" }, { status: 400 });
    }
    if (typeof item.content !== "string" || item.content.trim() === "") {
      return NextResponse.json({ error: "Each message must have non-empty text content" }, { status: 400 });
    }
    if (item.content.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: `Each message must be ${MAX_MESSAGE_CHARS} characters or fewer` }, { status: 413 });
    }
    totalChars += item.content.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      return NextResponse.json({ error: `Total message content must be ${MAX_TOTAL_CHARS} characters or fewer` }, { status: 413 });
    }
    validatedMessages.push({ role: item.role, content: item.content });
  }
  if (!validatedMessages.some((message) => message.role === "user")) {
    return NextResponse.json({ error: "At least one user message is required" }, { status: 400 });
  }
  if (isRateLimited(projectId)) {
    return NextResponse.json({ error: "Rate limit reached: at most 10 AI requests per project per minute." }, { status: 429 });
  }

  const mockMode = !process.env.AI_API_KEY && process.env.NODE_ENV !== "production" && process.env.AI_ALLOW_MOCK === "true";
  if (!process.env.AI_API_KEY && !mockMode) {
    return NextResponse.json({ error: "AI is not configured. Set AI_API_KEY, or explicitly enable AI_ALLOW_MOCK in development." }, { status: 503 });
  }

  if (mockMode) {
    try {
      const result = await chatWithAI(validatedMessages);
      return NextResponse.json({
        response: result.text,
        projectId,
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.inputTokens + result.outputTokens,
          usageEstimated: true,
          costUsd: 0,
          costTracked: false,
        },
      });
    } catch {
      return NextResponse.json({ error: "Development mock response failed" }, { status: 500 });
    }
  }

  let budgetConfig: ReturnType<typeof getBudgetConfig>;
  try {
    budgetConfig = getBudgetConfig();
  } catch {
    return NextResponse.json({
      error: "AI cost controls are not configured. Set AI_MONTHLY_LIMIT_USD and both per-million token rates before enabling real AI calls.",
    }, { status: 503 });
  }

  let reservationId = "";
  try {
    const reservation = await reserveAiUsage(projectId, totalChars * 2, 2000, budgetConfig);
    reservationId = reservation.reservationId;
  } catch (error) {
    if (error instanceof Error && error.message === "AI_BUDGET_EXCEEDED") {
      return NextResponse.json({ error: "This project's monthly AI budget has been reached." }, { status: 429 });
    }
    return NextResponse.json({ error: "AI usage ledger is unavailable; request blocked safely." }, { status: 503 });
  }

  let settled = false;
  try {
    const result = await chatWithAI(validatedMessages);
    const usage = await settleAiUsage(
      reservationId,
      result.inputTokens,
      result.outputTokens,
      result.usageEstimated,
      budgetConfig
    );
    settled = true;

    return NextResponse.json({
      response: result.text,
      projectId,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        usageEstimated: usage.usageEstimated,
        costUsd: usage.costUsd,
        monthlyLimitUsd: usage.monthlyLimitUsd,
        remainingUsd: usage.remainingUsd,
        monthToDateUsd: Math.max(0, usage.monthlyLimitUsd - usage.remainingUsd),
        month: usage.month,
        requests: usage.requests,
        costTracked: true,
      },
    });
  } catch (error) {
    if (!settled) {
      try { await releaseAiUsage(reservationId); } catch { /* fail closed; inspect the usage ledger */ }
    }
    if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
      return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
    }
    return NextResponse.json({ error: "AI provider or usage accounting failed; inspect server logs before retrying." }, { status: 502 });
  }
}
