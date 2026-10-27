export const runtime = 'nodejs';

import fs from 'fs';
import path from 'path';
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
    if (!isPathAllowed(safePath) || !fs.existsSync(safePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const content = fs.readFileSync(safePath, 'utf8');
    return NextResponse.json({ ok: true, content, path: safePath });
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

    const directory = path.dirname(safePath);
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(safePath)) {
      const backupDir = path.join(directory, '.alex', 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `${path.basename(safePath)}-${Date.now()}.bak`);
      fs.copyFileSync(safePath, backupPath);
    }

    fs.writeFileSync(safePath, content, 'utf8');
    return NextResponse.json({ ok: true, path: safePath });
  } catch {
    return NextResponse.json({ error: 'Forbidden path' }, { status: 403 });
  }
}
