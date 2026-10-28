import { POST as applyPost } from '../app/api/ai/apply/route';

function localPost(body: unknown) {
  return new Request('http://localhost:3000/api/ai/apply', {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('AI apply verification gate', () => {
  it('rejects an explicitly approved draft when no server verification proof is supplied', async () => {
    const response = await applyPost(localPost({
      projectId: 'test-project',
      approved: true,
      files: [{ path: 'index.html', content: '<h1>Draft</h1>', baseHash: null }],
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('successful, current server verification is required'),
    });
  });

  it('rejects a missing explicit user approval even if a proof-shaped field is present', async () => {
    const response = await applyPost(localPost({
      projectId: 'test-project',
      approved: false,
      files: [{ path: 'index.html', content: '<h1>Draft</h1>', baseHash: null }],
      verificationProof: 'forged',
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Explicit approval required before applying generated files',
    });
  });
});
