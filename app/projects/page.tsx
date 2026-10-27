import './globals.css';

export default function ProjectsPage() {
  return (
    <main className="workspace-layout">
      <aside className="sidebar">
        <h3>Alex Studio</h3>
        <ul>
          <li><a href="/">Dashboard</a></li>
          <li><a href="/projects">Projects</a></li>
          <li><a href="/editor">Editor</a></li>
          <li><a href="/preview/demo">Preview</a></li>
        </ul>
      </aside>

      <section className="panel">
        <h2>Projects</h2>
        <p>Project list and lifecycle controls will appear here.</p>
      </section>
    </main>
  );
}
