'use client';

import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react';

export function DiffEditor({ original, modified }: { original: string; modified: string }) {
  return (
    <div className="diff-shell" aria-label="Read-only file differences">
      <MonacoDiffEditor
        height="420px"
        language="html"
        theme="vs-dark"
        original={original}
        modified={modified}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          accessibilitySupport: 'auto',
        }}
      />
    </div>
  );
}
