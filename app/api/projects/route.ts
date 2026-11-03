export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { assertLocalMutation, assertLocalRequest } from '@/lib/path-security';
import { createProject, listProjects } from '@/lib/project-store';

export async function GET(request: Request) {
  if (!assertLocalRequest(request)) return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  return NextResponse.json({ projects: listProjects() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (!body || typeof body.name !== 'string') return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  try {
    return NextResponse.json({ project: createProject(body.name) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Project creation failed' }, { status: 400 });
  }
}
