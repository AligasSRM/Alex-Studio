export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { assertLocalRequest } from '@/lib/path-security';
import { getProject } from '@/lib/project-store';
import { listAIApplyBatches } from '@/lib/ai-apply-batches';

export async function GET(request: Request) {
  if (!assertLocalRequest(request)) {
    return NextResponse.json({ error: 'Local requests only' }, { status: 403 });
  }
  const projectId = new URL(request.url).searchParams.get('projectId') || '';
  if (!getProject(projectId)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  try {
    return NextResponse.json({ ok: true, batches: listAIApplyBatches(projectId) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read AI apply history' }, { status: 500 });
  }
}
