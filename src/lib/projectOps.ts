import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { validatePath, ensureWorkspace } from "./fileOps";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  type: "html-static";
  description?: string;
}

export function getProjectDir(projectId: string): string {
  return path.join(WORKSPACE_ROOT, projectId);
}

export function getProjectMetaPath(projectId: string): string {
  return path.join(getProjectDir(projectId), ".alex", "project.json");
}

export function projectExists(projectId: string): boolean {
  try {
    const metaPath = getProjectMetaPath(projectId);
    return fs.existsSync(metaPath);
  } catch {
    return false;
  }
}

export function createProject(name: string, description?: string): ProjectMeta {
  ensureWorkspace();

  // Generate unique ID
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    + "-" + Date.now().toString(36);

  const projectDir = getProjectDir(id);
  const alexDir = path.join(projectDir, ".alex");

  // Create directories
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(alexDir, { recursive: true });
  fs.mkdirSync(path.join(alexDir, "backups"), { recursive: true });

  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    type: "html-static",
    description,
  };

  // Write project metadata
  fs.writeFileSync(
    path.join(alexDir, "project.json"),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );

  // Create initial index.html
  const initialHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <p>Project created. Start building!</p>
</body>
</html>`;

  fs.writeFileSync(path.join(projectDir, "index.html"), initialHtml, "utf-8");

  // Initialize git repo
  try {
    execSync("git init", { cwd: projectDir, stdio: "pipe" });
    execSync('git config user.email "alex-studio@local"', { cwd: projectDir, stdio: "pipe" });
    execSync('git config user.name "Alex Studio"', { cwd: projectDir, stdio: "pipe" });
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" });
    execSync('git commit -m "Initial project creation"', { cwd: projectDir, stdio: "pipe" });
  } catch {
    // Git init failed - non-critical, continue
  }

  return meta;
}

export function getProject(projectId: string): ProjectMeta | null {
  try {
    const metaPath = getProjectMetaPath(projectId);
    if (!fs.existsSync(metaPath)) return null;
    const content = fs.readFileSync(metaPath, "utf-8");
    return JSON.parse(content) as ProjectMeta;
  } catch {
    return null;
  }
}

export function listProjects(): ProjectMeta[] {
  ensureWorkspace();
  const projects: ProjectMeta[] = [];

  try {
    const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const meta = getProject(entry.name);
        if (meta) {
          projects.push(meta);
        }
      }
    }
  } catch {
    // Directory read failed
  }

  // Sort by updatedAt (newest first)
  projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return projects;
}

export function updateProject(projectId: string, updates: Partial<Pick<ProjectMeta, "name" | "description">>): ProjectMeta | null {
  const meta = getProject(projectId);
  if (!meta) return null;

  if (updates.name) meta.name = updates.name;
  if (updates.description !== undefined) meta.description = updates.description;
  meta.updatedAt = new Date().toISOString();

  const metaPath = getProjectMetaPath(projectId);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  return meta;
}

export function deleteProject(projectId: string): boolean {
  const projectDir = getProjectDir(projectId);
  if (!fs.existsSync(projectDir)) return false;

  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function getProjectFiles(projectId: string): string[] {
  const projectDir = getProjectDir(projectId);
  if (!fs.existsSync(projectDir)) return [];

  const files: string[] = [];

  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".alex" || entry.name === ".git" || entry.name === "node_modules") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walk(projectDir, "");
  return files;
}
