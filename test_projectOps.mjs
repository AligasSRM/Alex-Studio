import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createProject, getProject, getProjectFiles, updateProject, deleteProject } from "./src/lib/projectOps.ts";

test("project creation escapes HTML and creates a usable project", () => {
  let projectId;
  try {
    const project = createProject('<script>alert("x")</script>', "test project");
    projectId = project.id;
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id));
    assert.equal(getProject(project.id)?.name, '<script>alert("x")</script>');

    const htmlPath = path.join(process.cwd(), "workspace", project.id, "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>alert"));
    assert.ok(getProjectFiles(project.id).includes("index.html"));

    const updated = updateProject(project.id, { description: "updated description" });
    assert.equal(updated?.description, "updated description");
  } finally {
    if (projectId) deleteProject(projectId);
  }
});

test("project operations reject traversal and malformed identifiers", () => {
  assert.equal(getProject("../outside"), null);
  assert.equal(deleteProject("../outside"), false);
  assert.throws(() => getProjectFiles("../outside"), /Invalid project id/);
});

test("project creation rejects invalid fields", () => {
  assert.throws(() => createProject("", "description"), /Project name is required/);
  assert.throws(() => createProject("x".repeat(101)), /100 characters or fewer/);
});
