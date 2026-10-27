import './globals.css';
import { DiffEditor } from '@/components/DiffEditor';

export default function EditorPage() {
  return (
    <main className="workspace-layout">
      <section className="panel wide-panel">
        <h2>Editor & Diff Review</h2>
        <DiffEditor
          original={'<h1>Hello</h1>\n<p>Original content</p>'}
          modified={'<h1>Hello</h1>\n<p>Updated content</p>\n<p>Approved summary</p>'}
        />
      </section>
    </main>
  );
}
