"use client";

import { useState, useEffect } from "react";

interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  description?: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch {
      setError("Failed to load projects");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchProjects(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const createProject = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create project");
        return;
      }
      setNewName("");
      setNewDesc("");
      await fetchProjects();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const deleteProject = async (id: string) => {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchProjects();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete");
      }
    } catch {
      setError("Network error");
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <h1 className="text-2xl font-bold mb-6">Projects</h1>

      {/* Create new project */}
      <div className="mb-8 p-4 border border-gray-300 rounded-lg bg-gray-50">
        <h2 className="text-lg font-semibold mb-3">Create New Project</h2>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded"
          />
          <button
            onClick={createProject}
            disabled={loading || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Project list */}
      <div className="space-y-3">
        {projects.length === 0 ? (
          <p className="text-gray-500">No projects yet. Create one above.</p>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className="p-4 border border-gray-300 rounded-lg flex justify-between items-start"
            >
              <div>
                <h3 className="font-semibold text-lg">{project.name}</h3>
                {project.description && (
                  <p className="text-gray-600 text-sm">{project.description}</p>
                )}
                <p className="text-gray-400 text-xs mt-1">
                  Type: {project.type} | Created: {new Date(project.createdAt).toLocaleDateString()}
                </p>
                <p className="text-gray-400 text-xs">ID: {project.id}</p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/editor?project=${project.id}`}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Open
                </a>
                <button
                  onClick={() => deleteProject(project.id)}
                  className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
