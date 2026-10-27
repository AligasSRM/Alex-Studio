import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { ensureWorkspace } from "./fileOps.ts";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");
const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  type: "html-static";
  description?: string;
}

function assertProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("Invalid project id");
  }
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertProjectPath(projectDir: string): void {
  if (!isWithinRoot(path.resolve(projectDir), WORKSPACE_ROOT)) {
    throw new Error("Project path is outside workspace");
  }
  if (fs.existsSync(projectDir)) {
    const realRoot = fs.realpathSync(WORKSPACE_ROOT);
    const appRoot = path.resolve(process.cwd());
    if (!isWithinRoot(realRoot, appRoot)) {
      throw new Error("Workspace root resolves outside the application directory");
    }
    const realProject = fs.realpathSync(projectDir);
    if (!isWithinRoot(realProject, realRoot)) {
      throw new Error("Project path resolves outside workspace");
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function validateText(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

export function getProjectDir(projectId: string): string {
  assertProjectId(projectId);
  const projectDir = path.resolve(WORKSPACE_ROOT, projectId);
  assertProjectPath(projectDir);
  return projectDir;
}

export function getProjectMetaPath(projectId: string): string {
  return path.join(getProjectDir(projectId), ".alex", "project.json");
}

export function validateProjectFilePath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500 || value.includes("\0") || value.includes("\\")) {
    throw new Error("Invalid project file path");
  }
  const parts = value.split("/");
  const projectId = parts[0];
  const fileParts = parts.slice(1);
  if (!projectId || fileParts.length === 0 || fileParts.some((part) =>
    !part || part === "." || part === ".." || part === ".alex" || part === ".git" || part === "node_modules"
  )) {
    throw new Error("Invalid project file path");
  }
  assertProjectId(projectId);
  const projectDir = getProjectDir(projectId);
  if (!projectExists(projectId)) throw new Error("Project not found");

  const resolved = path.resolve(projectDir, ...fileParts);
  if (!isWithinRoot(resolved, projectDir)) {
    throw new Error("Project file path is outside project");
  }

  const realProject = fs.realpathSync(projectDir);
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (fs.existsSync(existing)) {
    const realExisting = fs.realpathSync(existing);
    if (!isWithinRoot(realExisting, realProject)) {
      throw new Error("Project file path resolves outside project");
    }
  }

  return path.relative(WORKSPACE_ROOT, resolved).split(path.sep).join("/");
}


export function projectExists(projectId: string): boolean {
  try {
    const metaPath = getProjectMetaPath(projectId);
    return fs.existsSync(metaPath) && fs.statSync(metaPath).isFile();
  } catch {
    return false;
  }
}

export function createProject(name: string, description?: string): ProjectMeta {
  ensureWorkspace();
  const safeName = validateText(name, "Project name", 100);
  const safeDescription = description === undefined
    ? undefined
    : validateText(description, "Project description", 1000, true);

  const baseId = safeName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "project";
  const id = `${baseId}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const projectDir = getProjectDir(id);
  const alexDir = path.join(projectDir, ".alex");

  fs.mkdirSync(projectDir, { recursive: false });
  fs.mkdirSync(alexDir, { recursive: false });
  fs.mkdirSync(path.join(alexDir, "backups"), { recursive: false });

  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    id,
    name: safeName,
    createdAt: now,
    updatedAt: now,
    type: "html-static",
    description: safeDescription,
  };

  fs.writeFileSync(
    path.join(alexDir, "project.json"),
    JSON.stringify(meta, null, 2),
    { encoding: "utf-8", flag: "wx", mode: 0o600 }
  );

  const escapedName = escapeHtml(safeName);
  const initialHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedName}</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>${escapedName}</h1>
  <p>Project created. Start building!</p>
</body>
</html>`;

  fs.writeFileSync(path.join(projectDir, "index.html"), initialHtml, { encoding: "utf-8", flag: "wx", mode: 0o600 });

  try {
    execSync("git init", { cwd: projectDir, stdio: "pipe" });
    execSync('git config user.email "alex-studio@local"', { cwd: projectDir, stdio: "pipe" });
    execSync('git config user.name "Alex Studio"', { cwd: projectDir, stdio: "pipe" });
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" });
    execSync('git commit -m "Initial project creation"', { cwd: projectDir, stdio: "pipe" });
  } catch {
    // Project creation remains usable if Git is unavailable; surface this in a future status field.
  }

  return meta;
}

export function getProject(projectId: string): ProjectMeta | null {
  try {
    const metaPath = getProjectMetaPath(projectId);
    if (!fs.existsSync(metaPath) || !fs.statSync(metaPath).isFile()) return null;
    const content = fs.readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(content) as ProjectMeta;
    if (meta.id !== projectId || !PROJECT_ID_PATTERN.test(meta.id)) return null;
    return meta;
  } catch {
    return null;
  }
}

export function listProjects(): ProjectMeta[] {
  ensureWorkspace();
  const projects: ProjectMeta[] = [];
  const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const meta = getProject(entry.name);
    if (meta) projects.push(meta);
  }
  projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return projects;
}

export function updateProject(
  projectId: string,
  updates: Partial<Pick<ProjectMeta, "name" | "description">>
): ProjectMeta | null {
  const meta = getProject(projectId);
  if (!meta) return null;

  if (updates.name !== undefined) meta.name = validateText(updates.name, "Project name", 100);
  if (updates.description !== undefined) {
    meta.description = validateText(updates.description, "Project description", 1000, true);
  }
  meta.updatedAt = new Date().toISOString();

  const metaPath = getProjectMetaPath(projectId);
  const tmpPath = `${metaPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2), { encoding: "utf-8", flag: "wx", mode: 0o600 });
    fs.renameSync(tmpPath, metaPath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  }
  return meta;
}

export function deleteProject(projectId: string): boolean {
  try {
    const projectDir = getProjectDir(projectId);
    if (!fs.existsSync(projectDir)) return false;
    assertProjectPath(projectDir);
    const meta = getProject(projectId);
    if (!meta) return false;
    fs.rmSync(projectDir, { recursive: true, force: false });
    return true;
  } catch {
    return false;
  }
}

export function getProjectFiles(projectId: string): string[] {
  const projectDir = getProjectDir(projectId);
  if (!fs.existsSync(projectDir)) return [];
  const files: string[] = [];

  function walk(dir: string, prefix: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || [".alex", ".git", "node_modules", ".next", "coverage", "dist", "build", ".cache", ".turbo"].includes(entry.name)) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  }

  walk(projectDir, "");
  return files;
}
