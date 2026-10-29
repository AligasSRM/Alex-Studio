export const runtime = 'nodejs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation, resolveProjectPath } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { readProjectFile, writeProjectFile } from '@/lib/files';
import { readJsonBody } from '@/lib/request-body';
import { readBatchManifest, writeBatchManifest } from '@/lib/ai-apply-manifest';
import { recordAIApplyAudit } from '@/lib/ai-apply-audit';

function hash(content: string) { return createHash('sha256').update(content, 'utf8').digest('hex'); }

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  const parsed = await readJsonBody(request, 4096);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { projectId?: unknown; batchId?: unknown } | null;
  if (!body || typeof body.projectId !== 'string' || typeof body.batchId !== 'string') {
    return NextResponse.json({ error: 'projectId and batchId are required' }, { status: 400 });
  }
  if (!getProject(body.projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  let manifest;
  try { manifest = readBatchManifest(body.projectId, body.batchId); }
  catch { return NextResponse.json({ error: 'Batch manifest not found or invalid' }, { status: 404 }); }
  if (manifest.status !== 'applied') return NextResponse.json({ error: 'Only a successfully applied batch can be rolled back once' }, { status: 409 });

  try {
    for (let i = 0; i < manifest.paths.length; i++) {
      const target = resolveProjectPath(body.projectId, manifest.paths[i]);
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink()) {
        return NextResponse.json({ error: 'Rollback blocked: a target file is missing or unsafe', path: manifest.paths[i] }, { status: 409 });
      }
      const current = readProjectFile(body.projectId, manifest.paths[i]);
      if (hash(current) !== manifest.afterHashes[i]) {
        return NextResponse.json({ error: 'Rollback blocked: project files changed after this batch; no files were modified', path: manifest.paths[i] }, { status: 409 });
      }
    }
  } catch {
    return NextResponse.json({ error: 'Rollback validation failed; no files were modified' }, { status: 409 });
  }

  manifest.status = 'rollback-in-progress';
  writeBatchManifest(body.projectId, manifest);
  const restored: string[] = [];
  const failures: string[] = [];
  for (let i = manifest.paths.length - 1; i >= 0; i--) {
    const filePath = manifest.paths[i];
    try {
      const target = resolveProjectPath(body.projectId, filePath);
      const before = manifest.beforeContents[i];
      if (before === null) fs.rmSync(target);
      else writeProjectFile(body.projectId, filePath, before);
      restored.push(filePath);
    } catch { failures.push(filePath); }
  }
  if (failures.length) {
    return NextResponse.json({ error: 'Rollback incomplete; recovery is required', rollback: { status: 'INCOMPLETE', restoredPaths: restored, failedPaths: failures } }, { status: 500 });
  }
  manifest.status = 'rolled-back';
  manifest.rollbackTimestamp = new Date().toISOString();
  writeBatchManifest(body.projectId, manifest);
  try {
    recordAIApplyAudit(body.projectId, {
      batchId: manifest.batchId, timestamp: manifest.rollbackTimestamp, outcome: 'rolled-back',
      paths: manifest.paths, beforeHashes: manifest.afterHashes, afterHashes: manifest.beforeHashes.map((value) => value ?? 'deleted'),
      rollbackStatus: 'succeeded',
    });
  } catch {
    // The durable manifest remains the source of truth if the secondary audit append fails.
  }
  return NextResponse.json({ ok: true, batchId: manifest.batchId, rollback: { status: 'COMPLETE', restoredPaths: restored } }, { headers: { 'Cache-Control': 'no-store' } });
}
