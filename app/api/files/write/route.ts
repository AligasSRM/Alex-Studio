import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { resolveWorkspacePath, isPathAllowed, backupFile } from '@/lib/path-security';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const targetPath = typeof body?.path === 'string' ? body.path : '';
    const content = typeof body?.content === 'string' ? body.content : '';

    if (!targetPath || content === undefined) {
      return NextResponse.json({ error: 'Missing path or content' }, { status: 400 });
    }

    const safePath = resolveWorkspacePath(targetPath);
    if (!isPathAllowed(safePath)) {
      return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
    }

    const directory = path.dirname(safePath);
    fs.mkdirSync(directory, { recursive: true });

    if (fs.existsSync(safePath)) {
      backupFile(safePath);
    }

    fs.writeFileSync(safePath, content, 'utf8');

    return NextResponse.json({ ok: true, path: safePath, backedUp: fs.existsSync(safePath) });
  } catch {
    return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
  }
}
