export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createProjectZip } from '@/lib/zip-export';
import { assertLocalRequest } from '@/lib/path-security';
import { projectRoot } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';

export async function GET(request: Request) {
  if (!assertLocalRequest(request)) {
    return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  }

  const projectId = new URL(request.url).searchParams.get('projectId') || '';
  const project = getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  try {
    const archive = createProjectZip(projectRoot(project.id));
    const safeName = project.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="' + safeName + '.zip"',
        'Content-Length': String(archive.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Export failed' }, { status: 400 });
  }
}
