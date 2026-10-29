/**
 * Extract visible assistant text from raw Responses API JSON.
 * The OpenAI SDK exposes `output_text` as a convenience property, but raw
 * HTTP responses can expose the text only inside `output[].content[]`.
 */
export function extractAIResponseText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as {
    output_text?: unknown;
    output?: unknown;
    message?: unknown;
  };
  if (typeof response.output_text === 'string') return response.output_text;

  // Ollama's /api/chat response shape.
  if (response.message && typeof response.message === 'object') {
    const content = (response.message as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }

  if (!Array.isArray(response.output)) return null;
  const text: string[] = [];
  for (const item of response.output) {
    if (!item || typeof item !== 'object') continue;
    const outputItem = item as { type?: unknown; text?: unknown; content?: unknown };
    if (outputItem.type === 'output_text' && typeof outputItem.text === 'string') {
      text.push(outputItem.text);
      continue;
    }
    if (outputItem.type !== 'message' || !Array.isArray(outputItem.content)) continue;
    for (const part of outputItem.content) {
      if (!part || typeof part !== 'object') continue;
      const contentPart = part as { type?: unknown; text?: unknown };
      if ((contentPart.type === 'output_text' || contentPart.type === 'text') && typeof contentPart.text === 'string') {
        text.push(contentPart.text);
      }
    }
  }
  return text.length ? text.join('') : null;
}
