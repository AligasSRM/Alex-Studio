import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject } from '@/lib/project-store';

export default async function PreviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#0b1019', color: '#edf3fc', fontFamily: 'system-ui, sans-serif' }}>
      <p><Link href="/projects">← Back to projects</Link></p>
      <h1>{project.name} — Preview</h1>
      <p style={{ color: '#91a0b6' }}>This preview loads the current project files in a restricted sandbox.</p>
      <iframe
        title={`Preview of ${project.name}`}
        src={`/api/preview?projectId=${encodeURIComponent(projectId)}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{ display: 'block', width: '100%', minHeight: 620, border: '1px solid #263449', borderRadius: 12, background: '#fff' }}
      />
    </main>
  );
}
