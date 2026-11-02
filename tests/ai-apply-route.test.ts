import fs from 'node:fs';
import path from 'node:path';
import { POST } from '../app/api/ai/apply/route';
import { createProject } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';
import { issueVerificationProof } from '../lib/ai-verification-proof';

describe('AI apply platform mutation gate', () => {
  const ids: string[] = [];
  afterEach(() => {
    for (const id of ids.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  });

  it('returns 503 before snapshots, audit, or file changes while Windows-native mutation is unavailable', async () => {
    const project = createProject('AI Apply Gate ' + Date.now());
    ids.push(project.id);
    const file = path.join(projectRoot(project.id), 'index.html');
    const before = fs.readFileSync(file, 'utf8');
    const files = [{ path: 'index.html', content: '<h1>must not apply</h1>', baseHash: require('node:crypto').createHash('sha256').update(before).digest('hex') }];
    const verificationProof = issueVerificationProof(project.id, files);
    const response = await POST(new Request('http://localhost/api/ai/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost' },
      body: JSON.stringify({ projectId: project.id, approved: true, files, verificationProof }),
    }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/^UNAVAILABLE:/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(projectRoot(project.id), '.alex'))).toBe(false);
  });
});
