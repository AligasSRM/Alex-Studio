import { NextRequest, NextResponse } from "next/server";
import { readFile } from "@/lib/fileOps";
import { validateProjectFilePath } from "@/lib/projectOps";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path");
  if (!requestedPath) {
    return NextResponse.json({ error: "Missing 'path' parameter" }, { status: 400 });
  }

  let relativePath: string;
  try {
    relativePath = validateProjectFilePath(requestedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid project file path";
    const status = /outside project|outside workspace|resolves outside/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
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
