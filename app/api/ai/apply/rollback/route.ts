export const runtime = 'nodejs';

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { readProjectFile, writeProjectFile, deleteProjectFile } from '@/lib/files';
import { acquireAIApplyBatchLock, readAIApplyBatch, saveAIApplyBatch } from '@/lib/ai-apply-batches';
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

  let releaseBatchLock: (() => void) | undefined;
  try {
    releaseBatchLock = acquireAIApplyBatchLock(body.projectId, body.batchId);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return NextResponse.json({ error: 'Rollback is already running for this batch, or a previous process left a lock requiring manual inspection' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not acquire the exclusive rollback lock' }, { status: 500 });
  }
  try {
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

  const current: { path: string; content: string | null }[] = [];
  try {
    for (const snapshot of manifest.snapshots) {
      let content: string;
      try {
        content = readProjectFile(body.projectId, snapshot.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && snapshot.beforeContent === null) {
          current.push({ path: snapshot.path, content: null });
          continue;
        }
        throw new Error('A batch file is missing or is not a regular file: ' + snapshot.path);
      }
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
      const currentState = current.find((item) => item.path === snapshot.path)?.content;
      if (snapshot.beforeContent === null) {
        if (currentState !== null) deleteProjectFile(body.projectId, snapshot.path, snapshot.afterContent);
      } else if (currentState !== snapshot.beforeContent) {
        writeProjectFile(body.projectId, snapshot.path, snapshot.beforeContent, snapshot.afterContent);
      }
      restored.push(snapshot.path);
    } catch {
      failures.push(snapshot.path);
      // A write/unlink may have changed the directory entry before a later
      // fsync failed. Reconcile the on-disk state so compensation can restore
      // the post-apply bytes instead of silently leaving a partial rollback.
      try {
        let currentAfterFailure: string | null;
        try {
          currentAfterFailure = readProjectFile(body.projectId, snapshot.path);
        } catch (reconcileError) {
          if ((reconcileError as NodeJS.ErrnoException).code === 'ENOENT') currentAfterFailure = null;
          else throw reconcileError;
        }
        if (currentAfterFailure === snapshot.beforeContent) restored.push(snapshot.path);
      } catch {
        // State could not be established safely; leave the path for manual recovery.
      }
    }
  }

  if (failures.length) {
    const compensationFailures: string[] = [];
    for (const snapshot of manifest.snapshots) {
      if (!restored.includes(snapshot.path)) continue;
      try {
        writeProjectFile(body.projectId, snapshot.path, snapshot.afterContent, snapshot.beforeContent);
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
  } finally {
    releaseBatchLock?.();
  }
}
