export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createProject, listProjects } from '@/lib/project-store';

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';

  if (!name) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  const project = createProject(name);
  return NextResponse.json({ project }, { status: 201 });
}
