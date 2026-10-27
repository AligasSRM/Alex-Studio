import { NextRequest, NextResponse } from "next/server";
import { readFile } from "@/lib/fileOps";
import { projectExists } from "@/lib/projectOps";

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOCKED_SEGMENTS = new Set([".alex", ".git", "node_modules"]);

function validateProjectFilePath(value: string): string | null {
  const parts = value.split("/");
  if (parts.length < 2 || !PROJECT_ID_PATTERN.test(parts[0]) || parts.slice(1).some((part) => !part || BLOCKED_SEGMENTS.has(part))) {
    return null;
  }
  if (!projectExists(parts[0])) return null;
  return value;
}

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path");
  if (!requestedPath) {
    return NextResponse.json({ error: "Missing 'path' parameter" }, { status: 400 });
  }
  if (requestedPath.length > 500) {
    return NextResponse.json({ error: "Path is too long" }, { status: 400 });
  }

  const relativePath = validateProjectFilePath(requestedPath);
  if (!relativePath) {
    return NextResponse.json({ error: "Invalid project file path or project not found" }, { status: 400 });
  }

  try {
    const content = readFile(relativePath);
    return NextResponse.json({ path: relativePath, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File read failed";
    const status = /outside workspace|traversal|absolute|resolves outside/i.test(message) ? 403 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
