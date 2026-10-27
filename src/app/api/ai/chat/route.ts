"use server";

import { NextRequest, NextResponse } from "next/server";
import { chatWithAI, estimateTokens, type ChatMessage } from "@/lib/aiClient";

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 60_000;
const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Messages array is required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: `At most ${MAX_MESSAGES} messages are allowed` }, { status: 400 });
  }
  if (projectId !== undefined && (
    typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)
  )) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
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

  try {
    const inputTokens = validatedMessages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
    const response = await chatWithAI(validatedMessages);
    const outputTokens = estimateTokens(response);

    return NextResponse.json({
      response,
      projectId: projectId ?? null,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimateOnly: true,
      },
    });
  } catch {
    // Do not return provider response bodies or credentials to the client.
    return NextResponse.json({ error: "AI provider request failed" }, { status: 502 });
  }
}
