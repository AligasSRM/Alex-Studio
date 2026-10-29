export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { assertLocalRequest } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { listBatchManifests } from '@/lib/ai-apply-manifest';

export async function GET(request: Request) {
  if (!assertLocalRequest(request)) return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  const projectId = new URL(request.url).searchParams.get('projectId') || '';
  if (!getProject(projectId)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  try {
    return NextResponse.json({ batches: listBatchManifests(projectId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not read batch history' }, { status: 500 });
  }
}
