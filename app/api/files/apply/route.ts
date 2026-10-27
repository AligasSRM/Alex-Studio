import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { resolveWorkspacePath, isPathAllowed, backupFile } from '@/lib/path-security';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetPath = searchParams.get('path');

  if (!targetPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  try {
    const safePath = resolveWorkspacePath(targetPath);
    if (!isPathAllowed(safePath) || !fs.existsSync(safePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const content = fs.readFileSync(safePath, 'utf8');
    return NextResponse.json({ ok: true, content });
  } catch {
    return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const targetPath = typeof body?.path === 'string' ? body.path : '';
    const content = typeof body?.content === 'string' ? body.content : '';

    if (!targetPath) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    }

    const safePath = resolveWorkspacePath(targetPath);
    if (!isPathAllowed(safePath)) {
      return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
    }

    const writableDir = path.dirname(safePath);
    fs.mkdirSync(writableDir, { recursive: true });

    if (fs.existsSync(safePath)) {
      backupFile(safePath);
    }

    fs.writeFileSync(safePath, content, 'utf8');
    return NextResponse.json({ ok: true, path: safePath });
  } catch {
    return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
  }
}
