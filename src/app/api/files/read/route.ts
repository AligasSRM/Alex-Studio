import { NextRequest, NextResponse } from "next/server";
import { readFile, validatePath } from "@/lib/fileOps";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get("path");

  if (!path) {
    return NextResponse.json({ error: "Missing 'path' parameter" }, { status: 400 });
  }

  try {
    const content = readFile(path);
    return NextResponse.json({ path, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("outside workspace") || message.includes("traversal") || message.includes("Absolute") ? 403 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
