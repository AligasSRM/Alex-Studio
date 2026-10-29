import { extractAIResponseText } from '../lib/ai-response';

describe('AI Responses API text extraction', () => {
  it('reads the raw Responses API output array used by Groq', () => {
    expect(extractAIResponseText({
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'private reasoning' }] },
        { type: 'message', content: [{ type: 'output_text', text: '{"summary":' }, { type: 'output_text', text: '"ok"}' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    })).toBe('{"summary":"ok"}');
  });

  it('prefers an SDK convenience output_text property when available', () => {
    expect(extractAIResponseText({ output_text: 'hello', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ignored' }] }] })).toBe('hello');
  });

  it('supports Ollama chat message content and rejects absent text', () => {
    expect(extractAIResponseText({ message: { content: 'local model response' } })).toBe('local model response');
    expect(extractAIResponseText({ output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'not user output' }] }] })).toBeNull();
    expect(extractAIResponseText(null)).toBeNull();
  });
});
