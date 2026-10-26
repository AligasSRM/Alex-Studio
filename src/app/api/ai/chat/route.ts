import { NextRequest, NextResponse } from "next/server";
import { chatWithAI, estimateTokens, type ChatMessage } from "@/lib/aiClient";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, projectId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages array is required" }, { status: 400 });
    }

    // Validate message format
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        return NextResponse.json({ error: "Each message must have role and content" }, { status: 400 });
      }
      if (!["user", "assistant", "system"].includes(msg.role)) {
        return NextResponse.json({ error: "Invalid message role" }, { status: 400 });
      }
    }

    const inputTokens = messages.reduce((sum: number, m: ChatMessage) => sum + estimateTokens(m.content), 0);

    const response = await chatWithAI(messages as ChatMessage[]);

    const outputTokens = estimateTokens(response);

    return NextResponse.json({
      response,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
