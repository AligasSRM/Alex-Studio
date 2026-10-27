export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { resolveWorkspacePath, isPathAllowed } from '@/lib/path-security';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get('path');

  if (!requested) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  try {
    const safePath = resolveWorkspacePath(requested);
    if (!isPathAllowed(safePath)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, path: safePath });
  } catch (error) {
    return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
  }
}
