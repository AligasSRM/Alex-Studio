"use client";

import { useState } from "react";
import DiffEditor from "@/components/DiffEditor";

interface ProposedChange {
  path: string;
  original: string;
  modified: string;
  description: string;
}

export default function ReviewPage() {
  const [changes, setChanges] = useState<ProposedChange[]>([
    {
      path: "index.html",
      original: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Page</title>
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`,
      modified: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Page - Updated</title>
</head>
<body>
  <h1>Hello World</h1>
  <p>Updated content from AI</p>
</body>
</html>`,
      description: "Update index.html with new content",
    },
  ]);
  const [selectedChange, setSelectedChange] = useState(0);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [checksumBefore, setChecksumBefore] = useState("");
  const [checksumAfter, setChecksumAfter] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    if (status !== "pending") return;
    setLoading(true);
    setMessage("");

    try {
      const change = changes[selectedChange];

      // Record checksum before
      const beforeRes = await fetch(`/api/files/read?path=${encodeURIComponent(change.path)}`);
      const beforeData = await beforeRes.json();
      const beforeHash = beforeData.content
        ? await sha256(beforeData.content)
        : "FILE_NOT_EXISTS";
      setChecksumBefore(beforeHash);

      // Apply the change
      const applyRes = await fetch("/api/files/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: change.path, content: change.modified }),
      });

      if (!applyRes.ok) {
        const data = await applyRes.json();
        setMessage(`❌ Apply failed: ${data.error}`);
        return;
      }

      // Record checksum after
      const afterRes = await fetch(`/api/files/read?path=${encodeURIComponent(change.path)}`);
      const afterData = await afterRes.json();
      const afterHash = await sha256(afterData.content);
      setChecksumAfter(afterHash);

      setStatus("approved");
      setMessage("✅ Change approved and applied successfully.");
    } catch (e) {
      setMessage(`❌ Error: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (status !== "pending") return;
    setLoading(true);
    setMessage("");

    try {
      const change = changes[selectedChange];

      // Record checksum before
      const beforeRes = await fetch(`/api/files/read?path=${encodeURIComponent(change.path)}`);
      const beforeData = await beforeRes.json();
      const beforeHash = beforeData.content
        ? await sha256(beforeData.content)
        : "FILE_NOT_EXISTS";
      setChecksumBefore(beforeHash);

      // Do NOT apply — just record checksum after (should be same)
      const afterRes = await fetch(`/api/files/read?path=${encodeURIComponent(change.path)}`);
      const afterData = await afterRes.json();
      const afterHash = afterData.content
        ? await sha256(afterData.content)
        : "FILE_NOT_EXISTS";
      setChecksumAfter(afterHash);

      if (beforeHash === afterHash) {
        setStatus("rejected");
        setMessage("✅ Change rejected. File unchanged (checksums match).");
      } else {
        setMessage("⚠️ Warning: File changed despite rejection! Checksums differ.");
      }
    } catch (e) {
      setMessage(`❌ Error: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const change = changes[selectedChange];

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <h1 className="text-2xl font-bold mb-4">Review & Approve Changes</h1>

      {/* Change selector */}
      {changes.length > 1 && (
        <div className="mb-4">
          <label className="text-sm font-medium">Select change:</label>
          <select
            value={selectedChange}
            onChange={(e) => {
              setSelectedChange(Number(e.target.value));
              setStatus("pending");
              setMessage("");
            }}
            className="ml-2 p-2 border border-gray-300 rounded"
          >
            {changes.map((c, i) => (
              <option key={i} value={i}>
                {c.path} — {c.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Status badge */}
      <div className="mb-4">
        <span
          className={`px-3 py-1 rounded text-sm font-medium ${
            status === "pending"
              ? "bg-yellow-100 text-yellow-800"
              : status === "approved"
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {status === "pending" ? "⏳ Pending Review" : status === "approved" ? "✅ Approved" : "❌ Rejected"}
        </span>
      </div>

      {/* Diff viewer */}
      <DiffEditor
        original={change.original}
        modified={change.modified}
        language="html"
        height="400px"
      />

      {/* Action buttons */}
      {status === "pending" && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={handleApprove}
            disabled={loading}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? "Applying..." : "✅ Approve & Apply"}
          </button>
          <button
            onClick={handleReject}
            disabled={loading}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Checking..." : "❌ Reject"}
          </button>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="mt-4 p-3 rounded bg-gray-50 border border-gray-200 text-sm">
          {message}
        </div>
      )}

      {/* Checksum verification */}
      {(checksumBefore || checksumAfter) && (
        <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded text-xs font-mono">
          <div>Before: {checksumBefore}</div>
          <div>After:  {checksumAfter}</div>
          {checksumBefore && checksumAfter && (
            <div className="mt-1 font-bold">
              {checksumBefore === checksumAfter
                ? "🔒 Checksums match — file unchanged"
                : "⚠️ Checksums differ — file was modified"}
            </div>
          )}
        </div>
      )}

      {/* Security note */}
      <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h2 className="font-bold text-yellow-800 mb-2">Approval Rules</h2>
        <ul className="text-sm text-yellow-700 space-y-1">
          <li>• No changes are applied without explicit approval</li>
          <li>• Checksums are recorded before and after every action</li>
          <li>• Rejected changes leave the file completely unchanged</li>
          <li>• All changes are applied atomically (tmp → rename)</li>
          <li>• Backup is created before every approved change</li>
        </ul>
      </div>
    </div>
  );
}

// Client-side SHA-256 helper (Web Crypto API)
async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
