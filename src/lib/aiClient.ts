// AI Client — configurable via environment variables
// Set AI_API_KEY and AI_API_URL in .env.local

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface PlanResult {
  summary: string;
  steps: string[];
  files: Array<{
    path: string;
    action: "create" | "modify" | "delete";
    description: string;
  }>;
  estimatedTokens: number;
}

export async function chatWithAI(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    // Return a mock response for development
    return mockAIResponse(messages);
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response";
}

function mockAIResponse(messages: ChatMessage[]): string {
  const lastUser = messages.filter((m) => m.role === "user").pop();
  const request = lastUser?.content || "";

  return `## Plan for: "${request}"

### Summary
I'll create a simple HTML page based on your request. Here's what I plan to do:

### Steps
1. Create or modify \`index.html\` with the requested content
2. Add appropriate CSS styling
3. Ensure responsive design

### Files to Change
- **index.html** (modify) — Update content and structure based on your request

### Proposed Changes
\`\`\`html
<!-- Updated index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Updated Page</title>
  <style>
    body { font-family: sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #0066cc; }
    p { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Hello from Alex Studio!</h1>
  <p>This content was generated based on your request: "${request}"</p>
  <p>You can modify this further using the chat.</p>
</body>
</html>
\`\`\`

---
**Note:** This is a mock response. Set \`AI_API_KEY\` in \`.env.local\` to use a real AI model.`;
}

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}
