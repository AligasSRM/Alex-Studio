import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { POST } from '../app/api/ai/rollback/route';
import { createProject } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';
import { writeBatchManifest, type BatchManifest } from '../lib/ai-apply-manifest';

const ids: string[] = [];
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
function setup() {
  const project = createProject('Batch Recovery Test ' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  ids.push(project.id);
  const before = fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8');
  const after = '<h1>applied batch</h1>\\n';
  fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), after);
  const batchId = randomUUID();
  const manifest: BatchManifest = { batchId, timestamp: new Date().toISOString(), status: 'applied', paths: ['index.html'], beforeContents: [before], beforeHashes: [hash(before)], afterHashes: [hash(after)] };
  writeBatchManifest(project.id, manifest);
  return { project, before, batchId };
}
function makeRequest(projectId: string, batchId: string) {
  return new Request('http://localhost/api/ai/rollback', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost' }, body: JSON.stringify({ projectId, batchId }) });
}
afterEach(() => { for (const id of ids.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true }); });

describe('post-apply recovery route', () => {
  it('restores the pre-apply content and prevents a second rollback', async () => {
    const { project, before, batchId } = setup();
    const response = await POST(makeRequest(project.id, batchId));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.rollback.status).toBe('COMPLETE');
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(before);
    const { readBatchManifest } = await import('../lib/ai-apply-manifest');
    expect(readBatchManifest(project.id, batchId).status).toBe('rolled-back');
    expect((await POST(makeRequest(project.id, batchId))).status).toBe(409);
  });
  it('refuses to overwrite edits made after the batch', async () => {
    const { project, batchId } = setup();
    const laterEdit = '<h1>later user edit</h1>\\n';
    fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), laterEdit);
    const response = await POST(makeRequest(project.id, batchId));
    expect(response.status).toBe(409);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(laterEdit);
  });
});
