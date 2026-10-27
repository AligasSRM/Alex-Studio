'use client';

export function PreviewFrame({ html }: { html: string }) {
  return (
    <iframe
      title="Sandbox preview"
      sandbox="allow-scripts"
      srcDoc={html}
      style={{ width: '100%', minHeight: '420px', border: '1px solid #374151', borderRadius: 12 }}
    />
  );
}
