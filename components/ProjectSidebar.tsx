'use client';

export function ProjectSidebar() {
  return (
    <aside className="sidebar">
      <h3>Alex Studio</h3>
      <ul>
        <li><a href="/">Dashboard</a></li>
        <li><a href="/projects">Projects</a></li>
        <li><a href="/editor">Editor</a></li>
        <li><a href="/preview/demo">Preview</a></li>
      </ul>
    </aside>
  );
}
