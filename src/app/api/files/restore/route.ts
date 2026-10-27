import { NextRequest, NextResponse } from "next/server";
import { fileExists, readFile, restoreBackup } from "@/lib/fileOps";
import { validateProjectFilePath } from "@/lib/projectOps";
import { sha256Content } from "@/lib/checksum";
import path from "node:path";

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 2_000) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const { path: requestedPath, backupId, expectedSha256 } = body as {
    path?: unknown;
    backupId?: unknown;
    expectedSha256?: unknown;
  };
  if (typeof requestedPath !== "string" || typeof backupId !== "string" ||
      typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return NextResponse.json({ error: "Path, backupId, and expectedSha256 are required" }, { status: 400 });
  }

  let relativePath: string;
  try {
    relativePath = validateProjectFilePath(requestedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid project file path";
    const status = /outside project|outside workspace|resolves outside/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  if (!fileExists(relativePath)) {
    return NextResponse.json({ error: "Current file is missing; restore requires an existing file" }, { status: 409 });
  }
  if (sha256Content(readFile(relativePath)) !== expectedSha256) {
    return NextResponse.json({ error: "File changed since review; reload before restoring" }, { status: 409 });
  }

  try {
    const result = restoreBackup(relativePath, backupId);
    const savedContent = readFile(relativePath);
    const savedHash = sha256Content(savedContent);
    if (savedHash !== result.sha256) {
      return NextResponse.json({ error: "Restore read-back verification failed" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      path: relativePath,
      backup: result.safetyBackupPath ? path.basename(result.safetyBackupPath) : null,
      sha256: savedHash,
      verified: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed";
    const status = /invalid backup|backup does not belong|outside workspace|outside project/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
