export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { assertLocalMutation, assertLocalRequest } from '@/lib/path-security';
import { deleteProject, getProject, updateProject } from '@/lib/project-store';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  if (!assertLocalRequest(request)) return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  const { id } = await context.params;
  const project = getProject(id);
  return project ? NextResponse.json({ project }) : NextResponse.json({ error: 'Project not found' }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (!body || (body.name !== undefined && typeof body.name !== 'string')) {
    return NextResponse.json({ error: 'A valid project name is required' }, { status: 400 });
  }
  try {
    const project = updateProject(id, { name: body.name as string | undefined });
    return project ? NextResponse.json({ project }) : NextResponse.json({ error: 'Project not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Project update failed' }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: Context) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  const { id } = await context.params;
  try {
    return deleteProject(id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Project not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Project deletion failed' }, { status: 400 });
  }
}
