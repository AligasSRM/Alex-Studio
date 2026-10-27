'use client';

import Link from 'next/link';

export function ProjectSidebar() {
  return (
    <aside className="sidebar">
      <h3>Alex Studio</h3>
      <ul>
        <li><Link href="/">Dashboard</Link></li>
        <li><Link href="/projects">Projects</Link></li>
        <li><Link href="/editor">Editor</Link></li>
        <li><Link href="/preview/demo">Preview</Link></li>
      </ul>
    </aside>
  );
}
