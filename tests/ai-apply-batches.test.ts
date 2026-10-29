import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';
import { listAIApplyBatches, readAIApplyBatch, saveAIApplyBatch, type AIApplyBatchManifest } from '../lib/ai-apply-batches';

const projectIds: string[] = [];

function setupProject() {
  const project = createProject('AI Apply Batch Store Test ' + Date.now() + '-' + randomUUID().slice(0, 8));
  projectIds.push(project.id);
  return project;
}

function manifest(overrides: Partial<AIApplyBatchManifest> = {}): AIApplyBatchManifest {
  const now = new Date().toISOString();
  return {
    batchId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: 'applied',
    snapshots: [{ path: 'index.html', beforeContent: '<h1>before</h1>\n', afterContent: '<h1>after</h1>\n' }],
    ...overrides,
  };
}

afterEach(() => {
  for (const id of projectIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
});

describe('AI apply batch manifest storage', () => {
  it('persists full snapshots privately and lists only summary metadata', () => {
    const project = setupProject();
    const batch = manifest();
    saveAIApplyBatch(project.id, batch);

    expect(readAIApplyBatch(project.id, batch.batchId)).toEqual(batch);
    const summaries = listAIApplyBatches(project.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      batchId: batch.batchId,
      status: 'applied',
      paths: ['index.html'],
    });
    expect(JSON.stringify(summaries[0])).not.toContain('before</h1>');
    const manifestFile = path.join(projectRoot(project.id), '.alex', 'ai-apply-batches', batch.batchId + '.json');
    expect(fs.statSync(manifestFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(manifestFile)).mode & 0o777).toBe(0o700);
  });

  it('returns null for an unknown valid batch id and rejects malformed ids', () => {
    const project = setupProject();
    expect(readAIApplyBatch(project.id, randomUUID())).toBeNull();
    expect(() => readAIApplyBatch(project.id, '../escape')).toThrow(/invalid ai apply batch id/i);
  });

  it('rejects manifests with invalid status or oversized snapshot lists', () => {
    const project = setupProject();
    const invalidStatus = manifest({ status: 'not-a-status' as AIApplyBatchManifest['status'] });
    expect(() => saveAIApplyBatch(project.id, invalidStatus)).toThrow(/invalid ai apply batch manifest/i);

    const tooMany = manifest({
      batchId: randomUUID(),
      snapshots: Array.from({ length: 11 }, (_, index) => ({
        path: 'file-' + index + '.txt',
        beforeContent: null,
        afterContent: 'content',
      })),
    });
    expect(() => saveAIApplyBatch(project.id, tooMany)).toThrow(/invalid ai apply batch manifest/i);
  });

  it('does not follow a symlink in the batch metadata directory', () => {
    const project = setupProject();
    const metadata = path.join(projectRoot(project.id), '.alex');
    fs.mkdirSync(metadata, { mode: 0o700 });
    const outside = path.join(projectRoot(project.id), 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(metadata, 'ai-apply-batches'));
    expect(() => listAIApplyBatches(project.id)).toThrow(/must be a real directory/i);
  });
});
