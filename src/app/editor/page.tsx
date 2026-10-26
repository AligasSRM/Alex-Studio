"use client";

import { useState } from "react";
import DiffEditor from "@/components/DiffEditor";

const ORIGINAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Page</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>Hello World</h1>
  <p>This is the original content.</p>
</body>
</html>`;

const MODIFIED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Page - Updated</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f5f5f5; }
    h1 { color: #0066cc; }
    .highlight { background: yellow; }
  </style>
</head>
<body>
  <h1>Hello World</h1>
  <p>This is the <span class="highlight">updated</span> content.</p>
  <button>Click me</button>
</body>
</html>`;

export default function EditorPage() {
  const [showDiff, setShowDiff] = useState(true);

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <h1 className="text-2xl font-bold mb-4">DiffEditor Demo</h1>
      <p className="text-gray-600 mb-4">
        Comparing original vs modified HTML. Additions in green, removals in red.
      </p>
      <button
        onClick={() => setShowDiff(!showDiff)}
        className="mb-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        {showDiff ? "Hide Diff" : "Show Diff"}
      </button>
      {showDiff && (
        <DiffEditor
          original={ORIGINAL_HTML}
          modified={MODIFIED_HTML}
          language="html"
          height="600px"
        />
      )}
    </div>
  );
}
