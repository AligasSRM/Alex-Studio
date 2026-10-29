import { readJsonBody } from '../lib/request-body';

describe('bounded JSON request parsing', () => {
  it('parses valid JSON within the configured byte limit', async () => {
    const request = new Request('http://localhost/api/files', {
      method: 'POST',
      body: JSON.stringify({ content: 'safe' }),
    });
    await expect(readJsonBody(request, 100)).resolves.toEqual({
      ok: true,
      value: { content: 'safe' },
    });
  });

  it('rejects a declared oversized body before reading it', async () => {
    const request = new Request('http://localhost/api/files', {
      method: 'POST',
      headers: { 'content-length': '101' },
      body: '{}',
    });
    await expect(readJsonBody(request, 100)).resolves.toEqual({
      ok: false,
      status: 413,
      error: 'Request body too large',
    });
  });

  it('rejects an oversized body even when its declared length is absent or inaccurate', async () => {
    const request = new Request('http://localhost/api/files', {
      method: 'POST',
      body: JSON.stringify({ content: 'x'.repeat(200) }),
    });
    const result = await readJsonBody(request, 100);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it('rejects malformed JSON', async () => {
    const request = new Request('http://localhost/api/files', {
      method: 'POST',
      body: '{',
    });
    await expect(readJsonBody(request, 100)).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Malformed JSON',
    });
  });
});
