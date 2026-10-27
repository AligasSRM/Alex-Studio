import './globals.css';
import { ProjectSidebar } from '@/components/ProjectSidebar';

export default function ProjectsPage() {
  return (
    <main className="workspace-layout">
      <ProjectSidebar />
      <section className="panel">
        <h2>Projects</h2>
        <p>Project list and lifecycle controls will appear here.</p>
      </section>
    </main>
  );
}
