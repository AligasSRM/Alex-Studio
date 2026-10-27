'use client';

import Editor from '@monaco-editor/react';

export function DiffEditor({ original, modified }: { original: string; modified: string }) {
  return (
    <div className="diff-shell">
      <Editor
        height="240px"
        language="html"
        theme="vs-dark"
        options={{ readOnly: true, minimap: { enabled: false } }}
        defaultValue={original}
      />
      <Editor
        height="240px"
        language="html"
        theme="vs-dark"
        options={{ readOnly: true, minimap: { enabled: false } }}
        defaultValue={modified}
      />
    </div>
  );
}
