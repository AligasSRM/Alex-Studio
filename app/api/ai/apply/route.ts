export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { assertLocalMutation } from '@/lib/path-security';
import { WINDOWS_MUTATION_UNAVAILABLE } from '@/lib/platform-mutation';

export async function POST(request: Request) {
  if (!assertLocalMutation(request)) {
    return NextResponse.json({ error: 'Local same-origin requests only' }, { status: 403 });
  }
  return NextResponse.json(
    { error: WINDOWS_MUTATION_UNAVAILABLE },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
