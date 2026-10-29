export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { assertLocalMutation, assertLocalRequest } from '@/lib/path-security';
import { readProjectFile } from '@/lib/files';
import { getProject } from '@/lib/project-store';
import { loadEditorHistory, saveEditorHistory } from '@/lib/editor-history-store';
import { readJsonBody } from '@/lib/request-body';

const MAX_BODY_BYTES = 17 * 1024 * 1024;

export async function GET(request: Request) {
  if (!assertLocalRequest(request)) return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') || '';
  const filePath = url.searchParams.get('path') || '';
  if (!getProject(projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!filePath) return NextResponse.json({ error: 'File path is required' }, { status: 400 });
  try {
    const currentContent = readProjectFile(projectId, filePath);
    const history = loadEditorHistory(projectId, filePath, currentContent);
    return NextResponse.json({ history }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'History read failed' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { projectId?: unknown; path?: unknown; history?: unknown } | null;
  if (!body || typeof body.projectId !== 'string' || typeof body.path !== 'string' || !body.history) {
    return NextResponse.json({ error: 'projectId, path and history are required' }, { status: 400 });
  }
  if (!getProject(body.projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  try {
    readProjectFile(body.projectId, body.path);
    saveEditorHistory(body.projectId, body.path, body.history as never);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'History save failed' }, { status: 400 });
  }
}
