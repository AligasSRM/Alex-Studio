import fs from 'node:fs';
import path from 'node:path';
import { createProject } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';
import { recordAIApplyAudit } from '../lib/ai-apply-audit';

const ids: string[] = [];

function makeProject() {
  const project = createProject('AI Apply Audit ' + Date.now());
  ids.push(project.id);
  return project.id;
}

afterEach(() => {
  for (const id of ids.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
});

describe('AI apply audit ledger', () => {
  it('appends metadata-only events with restricted file permissions', () => {
    const id = makeProject();
    const event = {
      batchId: 'batch-test-1',
      timestamp: '2026-10-29T12:00:00.000Z',
      outcome: 'started' as const,
      paths: ['index.html'],
      beforeHashes: ['a'.repeat(64)],
      afterHashes: ['b'.repeat(64)],
    };
    recordAIApplyAudit(id, event);
    recordAIApplyAudit(id, { ...event, timestamp: '2026-10-29T12:00:01.000Z', outcome: 'applied', rollbackStatus: 'not-needed' });

    const file = path.join(projectRoot(id), '.alex', 'ai-apply-audit.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.outcome)).toEqual(['started', 'applied']);
    expect(lines[1].rollbackStatus).toBe('not-needed');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('<!doctype html>');
  });

  it('rejects a symlinked audit ledger', () => {
    const id = makeProject();
    const directory = path.join(projectRoot(id), '.alex');
    fs.mkdirSync(directory, { recursive: true });
    const outside = path.join(projectRoot(id), 'outside-audit.jsonl');
    fs.writeFileSync(outside, '');
    fs.symlinkSync(outside, path.join(directory, 'ai-apply-audit.jsonl'));
    expect(() => recordAIApplyAudit(id, {
      batchId: 'batch-test-2',
      timestamp: new Date().toISOString(),
      outcome: 'started',
      paths: ['index.html'],
      beforeHashes: [null],
      afterHashes: ['c'.repeat(64)],
    })).toThrow();
  });

  it('rejects a symlinked audit directory', () => {
    const id = makeProject();
    const directory = path.join(projectRoot(id), '.alex');
    const outside = path.join(projectRoot(id), 'outside-audit-dir');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, directory, 'dir');
    expect(() => recordAIApplyAudit(id, {
      batchId: 'batch-test-3',
      timestamp: new Date().toISOString(),
      outcome: 'started',
      paths: ['index.html'],
      beforeHashes: [null],
      afterHashes: ['d'.repeat(64)],
    })).toThrow('AI apply audit directory must be a real directory');
  });
});
