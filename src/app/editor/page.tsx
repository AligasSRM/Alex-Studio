"use client";

import { useEffect, useState } from "react";
import DiffEditor from "@/components/DiffEditor";

interface Project {
  id: string;
  name: string;
  description?: string;
}

interface Draft {
  projectId: string;
  path: string;
  baseContent: string;
  modifiedContent: string;
  baseHash: string;
}

export default function EditorPage() {
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [original, setOriginal] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("project") || "";
    setProjectId(id);
    if (!id) {
      setError("Open this editor from the Projects page by selecting a project.");
      setLoading(false);
      return;
    }

    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load project");
        if (!active) return;
        setProject(data.project);
        setFiles(Array.isArray(data.files) ? data.files : []);
        if (Array.isArray(data.files) && data.files.length > 0) {
          setSelectedFile(data.files[0]);
        } else {
          setNotice("This project has no editable files yet.");
          setLoading(false);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Unable to load project");
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!projectId || !selectedFile) return;
    let active = true;
    setLoading(true);
    setError("");
    setNotice("");

    (async () => {
      try {
        const filePath = `${projectId}/${selectedFile}`;
        const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to read file");
        if (!active) return;
        setOriginal(data.content);
        setContent(data.content);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Unable to read file");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [projectId, selectedFile]);

  const reviewChange = async () => {
    if (!projectId || !selectedFile || content === original || savingDraft) return;
    setSavingDraft(true);
    setError("");
    try {
      const baseHash = await sha256(original);
      const draft: Draft = { projectId, path: selectedFile, baseContent: original, modifiedContent: content, baseHash };
      sessionStorage.setItem(draftKey(projectId, selectedFile), JSON.stringify(draft));
      window.location.href = `/review?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(selectedFile)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to prepare review");
      setSavingDraft(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Project Editor</h1>
        <p className="mt-1 text-sm text-gray-600">
          {project ? `${project.name} · ${project.id}` : "Choose a project from the Projects page."}
        </p>
      </header>

      {error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-blue-800">{notice}</div>}

      {project && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label htmlFor="project-file" className="font-medium">File</label>
            <select
              id="project-file"
              value={selectedFile}
              onChange={(event) => setSelectedFile(event.target.value)}
              className="min-w-0 max-w-full rounded border border-gray-300 p-2"
              disabled={loading || files.length === 0}
            >
              {files.map((file) => <option key={file} value={file}>{file}</option>)}
            </select>
            <span className="text-sm text-gray-500">{loading ? "Loading…" : content === original ? "No unsaved changes" : "Unsaved draft"}</span>
          </div>

          <label htmlFor="file-content" className="mb-2 block font-medium">File content</label>
          <textarea
            id="file-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={loading || !selectedFile}
            spellCheck={false}
            className="min-h-72 w-full rounded border border-gray-300 p-3 font-mono text-sm"
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setContent(original)}
              disabled={loading || content === original}
              className="rounded border border-gray-300 px-4 py-2 disabled:opacity-50"
            >
              Discard local draft
            </button>
            <button
              type="button"
              onClick={reviewChange}
              disabled={loading || !selectedFile || content === original || savingDraft}
              className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {savingDraft ? "Preparing review…" : "Review proposed change"}
            </button>
          </div>

          {content !== original && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold">Live diff</h2>
              <DiffEditor original={original} modified={content} language={languageFor(selectedFile)} height="360px" />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function draftKey(projectId: string, path: string): string {
  return `alex-studio-draft:${projectId}:${path}`;
}

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "html") return "html";
  if (extension === "css") return "css";
  if (extension === "js" || extension === "mjs") return "javascript";
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (extension === "json") return "json";
  return "plaintext";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
