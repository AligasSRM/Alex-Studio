"use client";

import { useState } from "react";

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Preview Test</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f0f0f0; }
    h1 { color: #0066cc; }
    .box { background: white; padding: 15px; border-radius: 8px; margin-top: 10px; }
    button { padding: 8px 16px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Preview Test Page</h1>
  <div class="box">
    <p>This is a preview of HTML content rendered in an isolated iframe.</p>
    <button onclick="document.querySelector('.box').style.background = 'lightgreen'">
      Click to change color
    </button>
  </div>
  <script>
    // This should be blocked by CSP
    try {
      fetch('http://localhost:3000/api/secrets');
      console.log('FETCH SUCCEEDED (should not happen)');
    } catch (e) {
      console.log('FETCH BLOCKED (expected):', e.message);
    }
    // This should be blocked by sandbox
    try {
      window.parent.document.body.style.background = 'red';
      console.log('PARENT ACCESS SUCCEEDED (should not happen)');
    } catch (e) {
      console.log('PARENT ACCESS BLOCKED (expected):', e.message);
    }
  </script>
</body>
</html>`;

export default function PreviewPage() {
  const [htmlContent, setHtmlContent] = useState(SAMPLE_HTML);
  const [showPreview, setShowPreview] = useState(true);

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <h1 className="text-2xl font-bold mb-4">Isolated HTML Preview</h1>
      <p className="text-gray-600 mb-4">
        HTML rendered in a sandboxed iframe with strict CSP. Fetch and parent access are blocked.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">HTML Content:</label>
        <textarea
          value={htmlContent}
          onChange={(e) => setHtmlContent(e.target.value)}
          className="w-full h-40 p-3 border border-gray-300 rounded font-mono text-sm"
        />
      </div>

      <button
        onClick={() => setShowPreview(!showPreview)}
        className="mb-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        {showPreview ? "Hide Preview" : "Show Preview"}
      </button>

      {showPreview && (
        <div className="border-2 border-gray-300 rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-4 py-2 text-sm text-gray-600 border-b">
            Isolated Preview (sandbox + CSP)
          </div>
          <iframe
            srcDoc={htmlContent}
            sandbox="allow-scripts"
            className="w-full h-[500px] border-0"
            title="HTML Preview"
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h2 className="font-bold text-yellow-800 mb-2">Security Notes</h2>
        <ul className="text-sm text-yellow-700 space-y-1">
          <li>• <code>sandbox="allow-scripts"</code> — scripts can run but no top-level navigation, no popups, no same-origin access</li>
          <li>• CSP headers (set server-side) block fetch to external resources</li>
          <li>• <code>window.parent</code> access is blocked by sandbox</li>
          <li>• No cookies, localStorage, or sessionStorage access from iframe</li>
        </ul>
      </div>
    </div>
  );
}
