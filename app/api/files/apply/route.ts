export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { assertLocalMutation, assertLocalRequest } from '@/lib/path-security';
import { readProjectFile, writeProjectFile } from '@/lib/files';
import { getProject } from '@/lib/project-store';
import { readJsonBody } from '@/lib/request-body';

const MAX_WRITE_BODY_BYTES = 1_100_000;

export async function GET(request: Request) {
  if (!assertLocalRequest(request)) {
    return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') || '';
  const filePath = url.searchParams.get('path') || '';
  if (!getProject(projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  try {
    return NextResponse.json({ ok: true, content: readProjectFile(projectId, filePath) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Read failed' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) {
    return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  }

  const parsed = await readJsonBody(request, MAX_WRITE_BODY_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const body = parsed.value as { projectId?: unknown; path?: unknown; content?: unknown; approved?: unknown } | null;
  if (!body || typeof body.projectId !== 'string' || typeof body.path !== 'string' || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'projectId, path and content are required' }, { status: 400 });
  }
  if (body.approved !== true) {
    return NextResponse.json({ error: 'Explicit approval required' }, { status: 409 });
  }
  if (!getProject(body.projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  try {
    return NextResponse.json({ ok: true, ...writeProjectFile(body.projectId, body.path, body.content) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Apply failed' }, { status: 400 });
  }
}
