export const runtime = 'nodejs';

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertLocalMutation, resolveProjectPath, assertTextContent } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { readProjectFile, writeProjectFile } from '@/lib/files';

type Change = { path: string; content: string; baseHash: string | null };
function hash(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 3 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  const body = await request.json().catch(() => null) as { projectId?: unknown; approved?: unknown; files?: unknown; verificationProof?: unknown } | null;
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

  const applied: string[] = [];
  try {
    for (const change of changes) {
      writeProjectFile(body.projectId, change.path, change.content);
      applied.push(change.path);
    }
    return NextResponse.json({ ok: true, applied, count: applied.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    for (const snapshot of snapshots.filter((item) => applied.includes(item.path)).reverse()) {
      try {
        const target = resolveProjectPath(body.projectId, snapshot.path);
        if (snapshot.content === null) fs.rmSync(target, { force: true });
        else writeProjectFile(body.projectId, snapshot.path, snapshot.content);
      } catch { /* Preserve the original failure; any rollback issue must be surfaced below. */ }
    }
    return NextResponse.json({ error: error instanceof Error ? 'Batch apply failed; rollback was attempted: ' + error.message : 'Batch apply failed; rollback was attempted' }, { status: 500 });
  }
}
