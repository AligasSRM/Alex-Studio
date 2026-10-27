import './globals.css';

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <span className="eyebrow">Phase 0 • Proof of concept</span>
        <h1>Alex Studio</h1>
        <p>
          Local-first AI project workspace for review, approval, file safety, diffing,
          and isolated previewing.
        </p>
        <div className="cta-row">
          <a href="/projects">Open projects</a>
          <a href="/editor">Open editor</a>
        </div>
      </section>
    </main>
  );
}
