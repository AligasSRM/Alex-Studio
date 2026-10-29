import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createProject } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';
import { issueVerificationProof } from '../lib/ai-verification-proof';
import { POST as applyPOST } from '../app/api/ai/apply/route';
import { POST as rollbackPOST } from '../app/api/ai/apply/rollback/route';
import { GET as historyGET } from '../app/api/ai/apply/history/route';
import { readAIApplyBatch, saveAIApplyBatch } from '../lib/ai-apply-batches';

const projectIds: string[] = [];
const original = '<h1>before</h1>\n';
const changed = '<h1>after</h1>\n';

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function setupProject() {
  const project = createProject('AI Apply Rollback Route Test ' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  projectIds.push(project.id);
  fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), original);
  return project;
}

function localRequest(url: string, body?: unknown) {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { host: 'localhost', origin: 'http://localhost', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function applyBatch(projectId: string) {
  const files = [{ path: 'index.html', content: changed, baseHash: hash(original) }];
  const response = await applyPOST(localRequest('http://localhost/api/ai/apply', {
    projectId,
    approved: true,
    files,
    verificationProof: issueVerificationProof(projectId, files),
  }));
  expect(response.status).toBe(200);
  return response.json() as Promise<{ batchId: string }>;
}

afterEach(() => {
  for (const id of projectIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
});

describe('AI apply history and post-apply rollback routes', () => {
  it('lists an applied batch without exposing file contents and rolls it back after explicit approval', async () => {
    const project = setupProject();
    const { batchId } = await applyBatch(project.id);

    const historyResponse = await historyGET(localRequest('http://localhost/api/ai/apply/history?projectId=' + encodeURIComponent(project.id)));
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json();
    expect(history.batches).toContainEqual(expect.objectContaining({ batchId, status: 'applied', paths: ['index.html'] }));
    expect(JSON.stringify(history)).not.toContain('before</h1>');
    expect(JSON.stringify(history)).not.toContain('after</h1>');

    const rollbackResponse = await rollbackPOST(localRequest('http://localhost/api/ai/apply/rollback', {
      projectId: project.id,
      batchId,
      approved: true,
    }));
    expect(rollbackResponse.status).toBe(200);
    expect(await rollbackResponse.json()).toMatchObject({ ok: true, batchId, status: 'rolled-back', restoredPaths: ['index.html'] });
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(original);

    const finalHistoryResponse = await historyGET(localRequest('http://localhost/api/ai/apply/history?projectId=' + encodeURIComponent(project.id)));
    const finalHistory = await finalHistoryResponse.json();
    expect(finalHistory.batches).toContainEqual(expect.objectContaining({ batchId, status: 'rolled-back' }));
  });

  it('refuses rollback when a file changed after the batch was applied', async () => {
    const project = setupProject();
    const { batchId } = await applyBatch(project.id);
    const newerEdit = '<h1>newer user edit</h1>\n';
    fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), newerEdit);

    const response = await rollbackPOST(localRequest('http://localhost/api/ai/apply/rollback', {
      projectId: project.id,
      batchId,
      approved: true,
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/refusing to overwrite newer edits/i);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(newerEdit);
  });

  it('resumes an interrupted rollback when a file is already restored to its original bytes', async () => {
    const project = setupProject();
    const { batchId } = await applyBatch(project.id);
    const manifest = readAIApplyBatch(project.id, batchId);
    expect(manifest).not.toBeNull();
    saveAIApplyBatch(project.id, { ...manifest!, status: 'rolling-back', updatedAt: new Date().toISOString() });
    fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), original);

    const response = await rollbackPOST(localRequest('http://localhost/api/ai/apply/rollback', {
      projectId: project.id,
      batchId,
      approved: true,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, batchId, status: 'rolled-back' });
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(original);
  });

  it('requires explicit approval and rejects cross-origin requests', async () => {
    const project = setupProject();
    const { batchId } = await applyBatch(project.id);

    const notApproved = await rollbackPOST(localRequest('http://localhost/api/ai/apply/rollback', {
      projectId: project.id,
      batchId,
      approved: false,
    }));
    expect(notApproved.status).toBe(409);

    const crossOrigin = await rollbackPOST(new Request('http://localhost/api/ai/apply/rollback', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, batchId, approved: true }),
    }));
    expect(crossOrigin.status).toBe(403);
  });
});
