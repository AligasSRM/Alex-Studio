import './globals.css';
import { PreviewFrame } from '@/components/PreviewFrame';

export default function PreviewPage({ params }: { params: { projectId: string } }) {
  const html = `
    <html>
      <head>
        <style>
          body { font-family: sans-serif; padding: 24px; background: #111827; color: #f9fafb; }
          h1 { color: #7dd3fc; }
        </style>
      </head>
      <body>
        <h1>Preview for project ${params.projectId}</h1>
        <p>Sandboxed render area.</p>
      </body>
    </html>
  `;

  return (
    <main className="workspace-layout">
      <section className="panel wide-panel">
        <h2>Safe Preview</h2>
        <PreviewFrame html={html} />
      </section>
    </main>
  );
}
