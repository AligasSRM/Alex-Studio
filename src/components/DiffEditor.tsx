"use client";

import { DiffEditor as MonacoDiffEditor } from "@monaco-editor/react";
import { useState } from "react";

interface DiffEditorProps {
  original: string;
  modified: string;
  language?: string;
  height?: string;
}

export default function DiffEditor({
  original,
  modified,
  language = "html",
  height = "500px",
}: DiffEditorProps) {
  const [mounted, setMounted] = useState(false);

  return (
    <div className="w-full border border-gray-300 rounded-lg overflow-hidden">
      <MonacoDiffEditor
        height={height}
        language={language}
        original={original}
        modified={modified}
        onMount={() => setMounted(true)}
        options={{
          readOnly: true,
          renderSideBySide: true,
          enableSplitViewResizing: true,
          originalEditable: false,
          diffWordWrap: "on",
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          fontSize: 13,
        }}
        theme="vs-light"
      />
      {!mounted && (
        <div className="flex items-center justify-center h-full text-gray-500">
          Loading editor...
        </div>
      )}
    </div>
  );
}
