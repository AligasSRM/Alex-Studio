import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getProject, getProjectDir, getProjectFiles, validateProjectFilePath } from "@/lib/projectOps";
import { validatePath } from "@/lib/fileOps";
import { buildZip, type ZipEntry } from "@/lib/zip";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SECRET_NAME = /(^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|(?:service[-_]?account|api[-_]?key|access[-_]?token|refresh[-_]?token|private(?:[-_]?key)?|credentials?|secrets?|tokens?)(?:\.[^/]*)?|id_rsa|id_ed25519)(?:$|\/)/i;
const SECRET_EXTENSION = /\.(?:pem|key|p12|pfx|keystore|jks|secret)$/i;
const GENERATED_SEGMENT = /^(?:\.next|node_modules|\.git|\.alex|coverage|dist|build)$/i;

function shouldExclude(relativePath: string): boolean {
  const parts = relativePath.split("/");
  return parts.some((part) => part.startsWith(".") || GENERATED_SEGMENT.test(part))
    || SECRET_NAME.test(relativePath)
    || SECRET_EXTENSION.test(relativePath);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const projectDir = getProjectDir(id);
    const files = getProjectFiles(id).filter((relativePath) => !shouldExclude(relativePath));
    if (files.length === 0) {
      return NextResponse.json({ error: "No exportable project files were found" }, { status: 400 });
    }

    const entries: ZipEntry[] = [];
    let totalBytes = 0;
    for (const relativePath of files) {
      const workspaceRelativePath = validateProjectFilePath(`${id}/${relativePath}`);
      const fullPath = validatePath(workspaceRelativePath);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `File exceeds the 10 MB export limit: ${relativePath}` }, { status: 413 });
      }
      totalBytes += stat.size;
      if (totalBytes > 50 * 1024 * 1024) {
        return NextResponse.json({ error: "Project export exceeds the 50 MB limit" }, { status: 413 });
      }
      const resolved = fs.realpathSync(fullPath);
      const realProject = fs.realpathSync(projectDir);
      const rel = path.relative(realProject, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return NextResponse.json({ error: "Export path escaped the project boundary" }, { status: 403 });
      }
      entries.push({ name: relativePath, data: fs.readFileSync(resolved) });
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: "No exportable files remain after security exclusions" }, { status: 400 });
    }

    const archive = buildZip(entries);
    return new NextResponse(archive, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="alex-studio-${id}.zip"`,
        "Content-Length": String(archive.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Project export failed safely" }, { status: 500 });
  }
}
