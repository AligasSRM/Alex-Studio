import { NextRequest, NextResponse } from "next/server";
import { writeFile, createBackup, validatePath, fileExists, readFile } from "@/lib/fileOps";
import { projectExists } from "@/lib/projectOps";
import { sha256Content } from "@/lib/checksum";
import fs from "node:fs";

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOCKED_SEGMENTS = new Set([".alex", ".git", "node_modules"]);

function validateProjectFilePath(value: string): boolean {
  const parts = value.split("/");
  return parts.length >= 2
    && PROJECT_ID_PATTERN.test(parts[0])
    && parts.slice(1).every((part) => part.length > 0 && !BLOCKED_SEGMENTS.has(part))
    && projectExists(parts[0]);
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 1_100_000) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }

    const { path: relativePath, content, expectedSha256 } = body as {
      path?: unknown;
      content?: unknown;
      expectedSha256?: unknown;
    };

    if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.length > 500) {
      return NextResponse.json({ error: "Missing or invalid 'path'" }, { status: 400 });
    }
    if (typeof content !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'content'" }, { status: 400 });
    }
    if (content.length > 1_000_000) {
      return NextResponse.json({ error: "File content is too large (maximum 1,000,000 characters)" }, { status: 413 });
    }
    if (expectedSha256 !== undefined && expectedSha256 !== "MISSING" &&
      (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256))) {
      return NextResponse.json({ error: "Invalid expectedSha256 value" }, { status: 400 });
    }
    if (!validateProjectFilePath(relativePath)) {
      return NextResponse.json({ error: "Invalid project file path or project not found" }, { status: 400 });
    }

    let fullPath: string;
    try {
      fullPath = validatePath(relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid path";
      return NextResponse.json({ error: message }, { status: 403 });
    }

    const existed = fileExists(relativePath);
    if (expectedSha256 !== undefined) {
      if (expectedSha256 === "MISSING" && existed) {
        return NextResponse.json({ error: "File changed since review; reload before applying" }, { status: 409 });
      }
      if (expectedSha256 !== "MISSING") {
        if (!existed) {
          return NextResponse.json({ error: "File disappeared since review; reload before applying" }, { status: 409 });
        }
        const currentHash = sha256Content(readFile(relativePath));
        if (currentHash !== expectedSha256) {
          return NextResponse.json({ error: "File changed since review; reload before applying" }, { status: 409 });
        }
      }
    }

    let backupPath: string | null = null;
    if (existed) {
      try {
        backupPath = createBackup(relativePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Backup failed";
        return NextResponse.json({ error: `Backup failed: ${message}` }, { status: 500 });
      }
    }

    try {
      writeFile(relativePath, content);
    } catch (error) {
      if (backupPath && fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(backupPath, fullPath);
        } catch {
          // Preserve the original write error; backup recovery needs a separate alert.
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
      sha256: sha256Content(content),
    });
  } catch {
    return NextResponse.json({ error: "Unable to apply file change" }, { status: 500 });
  }
}
