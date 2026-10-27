export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { resolveWorkspacePath, isPathAllowed } from '@/lib/path-security';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { path, content } = body ?? {};

    if (!path || typeof path !== 'string' || typeof content !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const safePath = resolveWorkspacePath(path);
    if (!isPathAllowed(safePath)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, path: safePath, saved: true });
  } catch (error) {
    return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
  }
}
