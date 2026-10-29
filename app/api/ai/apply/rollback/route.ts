export const runtime = 'nodejs';

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation, resolveProjectPath } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { readProjectFile, writeProjectFile } from '@/lib/files';
import { readAIApplyBatch, saveAIApplyBatch } from '@/lib/ai-apply-batches';
import { recordAIApplyAudit } from '@/lib/ai-apply-audit';
import { readJsonBody } from '@/lib/request-body';

const MAX_BODY_BYTES = 16 * 1024;

function hash(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) {
    return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  }
  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { projectId?: unknown; batchId?: unknown; approved?: unknown } | null;
  if (!body || typeof body.projectId !== 'string' || typeof body.batchId !== 'string') {
    return NextResponse.json({ error: 'projectId and batchId are required' }, { status: 400 });
  }
  if (body.approved !== true) {
    return NextResponse.json({ error: 'Explicit approval required before rolling back an applied batch' }, { status: 409 });
  }
  if (!getProject(body.projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  let manifest;
  try {
    manifest = readAIApplyBatch(body.projectId, body.batchId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read batch manifest' }, { status: 400 });
  }
  if (!manifest) return NextResponse.json({ error: 'AI apply batch not found' }, { status: 404 });
  if (!['applied', 'rollback-failed', 'rolling-back'].includes(manifest.status)) {
    return NextResponse.json({ error: 'Only a currently applied batch can be rolled back', status: manifest.status }, { status: 409 });
  }

  const current: { path: string; content: string }[] = [];
  try {
    for (const snapshot of manifest.snapshots) {
      const target = resolveProjectPath(body.projectId, snapshot.path);
      if (!fs.existsSync(target)) {
        if (snapshot.beforeContent === null) {
          current.push({ path: snapshot.path, content: '' });
          continue;
        }
        throw new Error('A batch file is missing or is not a regular file: ' + snapshot.path);
      }
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('A batch file is missing or is not a regular file: ' + snapshot.path);
      }
      const content = readProjectFile(body.projectId, snapshot.path);
      const matchesApplied = hash(content) === hash(snapshot.afterContent);
      const matchesAlreadyRestored = snapshot.beforeContent !== null && hash(content) === hash(snapshot.beforeContent);
      if (!matchesApplied && !matchesAlreadyRestored) {
        throw new Error('Project files changed after this batch was applied. Refusing to overwrite newer edits: ' + snapshot.path);
      }
      current.push({ path: snapshot.path, content });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not validate current files' }, { status: 409 });
  }

  const rollbackStartedAt = new Date().toISOString();
  const restored: string[] = [];
  const failures: string[] = [];
  try {
    saveAIApplyBatch(body.projectId, { ...manifest, updatedAt: rollbackStartedAt, status: 'rolling-back', rollbackError: undefined });
  } catch {
    return NextResponse.json({ error: 'Could not persist rollback intent; no files were changed' }, { status: 500 });
  }

  for (const snapshot of [...manifest.snapshots].reverse()) {
    try {
      const target = resolveProjectPath(body.projectId, snapshot.path);
      if (snapshot.beforeContent === null) fs.rmSync(target, { force: true });
      else writeProjectFile(body.projectId, snapshot.path, snapshot.beforeContent);
      restored.push(snapshot.path);
    } catch {
      failures.push(snapshot.path);
    }
  }

  if (failures.length) {
    const compensationFailures: string[] = [];
    for (const snapshot of manifest.snapshots) {
      if (!restored.includes(snapshot.path)) continue;
      try {
        writeProjectFile(body.projectId, snapshot.path, snapshot.afterContent);
      } catch {
        compensationFailures.push(snapshot.path);
      }
    }
    const rollbackError = 'Rollback failed for: ' + failures.join(', ') +
      (compensationFailures.length ? '; restoring post-apply content also failed for: ' + compensationFailures.join(', ') : '');
    try {
      saveAIApplyBatch(body.projectId, {
        ...manifest,
        updatedAt: new Date().toISOString(),
        status: 'rollback-failed',
        rollbackError,
      });
    } catch {
      // Keep the rolling-back manifest as evidence if the status update fails.
    }
    return NextResponse.json({
      error: rollbackError,
      batchId: manifest.batchId,
      status: 'rollback-failed',
      failedPaths: failures,
      compensationFailures,
    }, { status: 500 });
  }

  const rolledBackAt = new Date().toISOString();
  try {
    saveAIApplyBatch(body.projectId, { ...manifest, updatedAt: rolledBackAt, status: 'rolled-back' });
    recordAIApplyAudit(body.projectId, {
      batchId: manifest.batchId,
      timestamp: rolledBackAt,
      outcome: 'rolled-back',
      paths: manifest.snapshots.map((snapshot) => snapshot.path),
      beforeHashes: manifest.snapshots.map((snapshot) => snapshot.beforeContent === null ? null : hash(snapshot.beforeContent)),
      afterHashes: manifest.snapshots.map((snapshot) => hash(snapshot.afterContent)),
      rollbackStatus: 'succeeded',
    });
  } catch {
    return NextResponse.json({ error: 'Files were restored, but the final rollback evidence could not be persisted', batchId: manifest.batchId, status: 'rolled-back-evidence-incomplete' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, batchId: manifest.batchId, status: 'rolled-back', restoredPaths: restored }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
