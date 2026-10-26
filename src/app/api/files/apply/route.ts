import { NextRequest, NextResponse } from "next/server";
import { writeFile, createBackup, validatePath, fileExists } from "@/lib/fileOps";
import fs from "fs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: relativePath, content } = body;

    if (!relativePath || typeof relativePath !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'path'" }, { status: 400 });
    }

    if (typeof content !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'content'" }, { status: 400 });
    }

    // Validate path first (will throw if invalid)
    let fullPath: string;
    try {
      fullPath = validatePath(relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid path";
      return NextResponse.json({ error: message }, { status: 403 });
    }

    // Check if file exists (for backup)
    const existed = fileExists(relativePath);
    let backupPath: string | null = null;

    if (existed) {
      try {
        backupPath = createBackup(relativePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Backup failed";
        return NextResponse.json({ error: `Backup failed: ${message}` }, { status: 500 });
      }
    }

    // Write the file atomically
    try {
      writeFile(relativePath, content);
    } catch (error) {
      // Rollback: restore from backup if write failed
      if (backupPath && fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(backupPath, fullPath);
        } catch {
          // Rollback failed - log but don't mask original error
        }
      }
      const message = error instanceof Error ? error.message : "Write failed";
      return NextResponse.json({ error: `Write failed: ${message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      path: relativePath,
      backup: backupPath,
      created: !existed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
