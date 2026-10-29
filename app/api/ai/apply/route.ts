export const runtime = 'nodejs';

import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation, resolveProjectPath, assertTextContent } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { readProjectFile, writeProjectFile } from '@/lib/files';
import { verifyVerificationProof } from '@/lib/ai-verification-proof';
import { rollbackAppliedSnapshots } from '@/lib/ai-apply-rollback';
import { recordAIApplyAudit } from '@/lib/ai-apply-audit';
import { saveAIApplyBatch } from '@/lib/ai-apply-batches';
import { readJsonBody } from '@/lib/request-body';

const MAX_APPLY_BODY_BYTES = 3 * 1024 * 1024;

type Change = { path: string; content: string; baseHash: string | null };
function hash(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  const parsed = await readJsonBody(request, MAX_APPLY_BODY_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { projectId?: unknown; approved?: unknown; files?: unknown; verificationProof?: unknown } | null;
  if (!body || typeof body.projectId !== 'string' || !Array.isArray(body.files)) {
    return NextResponse.json({ error: 'projectId and files are required' }, { status: 400 });
  }
  if (body.approved !== true) return NextResponse.json({ error: 'Explicit approval required before applying generated files' }, { status: 409 });
  if (!verifyVerificationProof(body.projectId, body.files, body.verificationProof)) return NextResponse.json({ error: 'A successful, current server verification is required before applying this AI draft. Verify the exact draft again.' }, { status: 409 });
  if (!getProject(body.projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (body.files.length < 1 || body.files.length > 10) return NextResponse.json({ error: 'Apply between 1 and 10 files per batch' }, { status: 400 });

  const seen = new Set<string>();
  const changes: Change[] = [];
  let totalBytes = 0;
  try {
    for (const item of body.files) {
      if (!item || typeof item !== 'object') throw new Error('Invalid file change');
      const file = item as Partial<Change>;
      if (typeof file.path !== 'string' || typeof file.content !== 'string' ||
          !(file.baseHash === null || (typeof file.baseHash === 'string' && /^[a-f0-9]{64}$/.test(file.baseHash)))) {
        throw new Error('Invalid file change');
      }
      assertTextContent(file.content);
      totalBytes += Buffer.byteLength(file.content, 'utf8');
      if (totalBytes > 2 * 1024 * 1024) throw new Error('Generated batch exceeds 2 MiB');
      const normalized = file.path.replace(/\\/g, '/');
      resolveProjectPath(body.projectId, normalized);
      if (normalized !== file.path || seen.has(normalized)) throw new Error('Duplicate or non-canonical file path');
      if (/(^|\/)(\.env[^/]*|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|secrets?[^/]*|node_modules|\.git|\.alex)(\/|$)/i.test(normalized)) {
        throw new Error('Protected path denied');
      }
      seen.add(normalized);
      changes.push({ path: normalized, content: file.content, baseHash: file.baseHash });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid file changes' }, { status: 400 });
  }

  const snapshots: { path: string; content: string | null }[] = [];
  try {
    for (const change of changes) {
      const target = resolveProjectPath(body.projectId, change.path);
      let current: string | null = null;
      if (fs.existsSync(target)) {
        if (!fs.statSync(target).isFile() || fs.lstatSync(target).isSymbolicLink()) throw new Error('Target must be a regular file');
        current = readProjectFile(body.projectId, change.path);
      }
      const actualHash = current === null ? null : hash(current);
      if (actualHash !== change.baseHash) throw new Error('Project changed since the AI draft was prepared. Generate a fresh draft before applying.');
      snapshots.push({ path: change.path, content: current });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not validate current project files' }, { status: 409 });
  }

  const batchId = randomUUID();
  const createdAt = new Date().toISOString();
  const auditEvent = {
    batchId,
    timestamp: createdAt,
    paths: changes.map((change) => change.path),
    beforeHashes: snapshots.map((snapshot) => snapshot.content === null ? null : hash(snapshot.content)),
    afterHashes: changes.map((change) => hash(change.content)),
  };
  const batchManifest = {
    batchId,
    createdAt,
    updatedAt: createdAt,
    status: 'started' as const,
    snapshots: snapshots.map((snapshot, index) => ({
      path: snapshot.path,
      beforeContent: snapshot.content,
      afterContent: changes[index].content,
    })),
  };
  try {
    saveAIApplyBatch(body.projectId, batchManifest);
  } catch {
    return NextResponse.json({ error: 'Could not persist the AI apply batch snapshots; no files were changed' }, { status: 500 });
  }
  try {
    recordAIApplyAudit(body.projectId, { ...auditEvent, outcome: 'started' });
  } catch {
    return NextResponse.json({ error: 'Could not record the apply audit; no files were changed' }, { status: 500 });
  }

  const applied: string[] = [];
  try {
    for (const change of changes) {
      writeProjectFile(body.projectId, change.path, change.content);
      applied.push(change.path);
    }
    const appliedAt = new Date().toISOString();
    saveAIApplyBatch(body.projectId, { ...batchManifest, updatedAt: appliedAt, status: 'applied' });
    recordAIApplyAudit(body.projectId, { ...auditEvent, timestamp: appliedAt, outcome: 'applied', rollbackStatus: 'not-needed' });
    return NextResponse.json({ ok: true, batchId, applied, count: applied.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const rollbackFailures = rollbackAppliedSnapshots(snapshots, applied, (snapshot) => {
      const target = resolveProjectPath(body.projectId as string, snapshot.path);
      if (snapshot.content === null) fs.rmSync(target, { force: true });
      else writeProjectFile(body.projectId as string, snapshot.path, snapshot.content);
    });
    const rollbackStatus = rollbackFailures.length ? 'failed' : 'succeeded';
    const failedAt = new Date().toISOString();
    try {
      saveAIApplyBatch(body.projectId, {
        ...batchManifest,
        updatedAt: failedAt,
        status: rollbackFailures.length ? 'rollback-failed' : 'rolled-back',
        ...(rollbackFailures.length ? { rollbackError: rollbackFailures.join(', ') } : {}),
      });
    } catch {
      // The started manifest remains evidence if the final status update fails.
    }
    try {
      recordAIApplyAudit(body.projectId, { ...auditEvent, timestamp: failedAt, outcome: 'failed', rollbackStatus });
    } catch {
      // The initial started event remains as evidence if the final audit append also fails.
    }
    const originalError = error instanceof Error ? error.message : 'unknown write error';
    if (rollbackFailures.length) {
      return NextResponse.json({
        error: 'Batch apply failed: ' + originalError + '. Rollback failed; manual recovery may be required for: ' + rollbackFailures.join(', '),
        batchId,
        rollbackStatus: 'failed',
        rollback: { status: 'INCOMPLETE', failedPaths: rollbackFailures },
      }, { status: 500 });
    }
    return NextResponse.json({
      error: 'Batch apply failed: ' + originalError + '. All previously applied files were restored from snapshots.',
      batchId,
      rollbackStatus: 'succeeded',
      rollback: { status: 'COMPLETE', restoredPaths: applied.slice().reverse() },
    }, { status: 500 });
  }
}
