"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DiffEditor from "@/components/DiffEditor";

interface Draft {
  projectId: string;
  path: string;
  baseContent: string;
  modifiedContent: string;
  baseHash: string;
}

type ReviewStatus = "pending" | "approved" | "rejected" | "restored";

export default function ReviewPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [checksumBefore, setChecksumBefore] = useState("");
  const [checksumAfter, setChecksumAfter] = useState("");
  const [backupId, setBackupId] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
      const params = new URLSearchParams(window.location.search);
      const projectId = params.get("project") || "";
      const filePath = params.get("path") || "";
      if (!projectId || !filePath) {
        setError("Missing project or file. Return to the editor and prepare a change.");
        setLoading(false);
        return;
      }

      try {
        const stored = sessionStorage.getItem(draftKey(projectId, filePath));
        if (!stored) throw new Error("No pending draft was found. Return to the editor and prepare the change again.");
        const parsed = JSON.parse(stored) as Draft;
        if (parsed.projectId !== projectId || parsed.path !== filePath ||
          typeof parsed.baseContent !== "string" || typeof parsed.modifiedContent !== "string" ||
          typeof parsed.baseHash !== "string" || !/^[a-f0-9]{64}$/.test(parsed.baseHash)) {
          throw new Error("The stored draft is invalid. Return to the editor and prepare the change again.");
        }
        if (await sha256(parsed.baseContent) !== parsed.baseHash) {
          throw new Error("Draft integrity check failed. Return to the editor and prepare the change again.");
        }

        const response = await fetch(`/api/files/read?path=${encodeURIComponent(`${projectId}/${filePath}`)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to verify the current file");
        const currentHash = await sha256(data.content);
        if (currentHash !== parsed.baseHash) {
          throw new Error("This file changed after the draft was prepared. Return to the editor, reload it, and review the change again.");
        }
        if (!active) return;
        setDraft(parsed);
        setChecksumBefore(parsed.baseHash);
        setChecksumAfter(currentHash);
        setReady(true);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Unable to load review");
      } finally {
        if (active) setLoading(false);
      }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const handleApprove = async () => {
    if (!draft || status !== "pending" || !ready || busy) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/files/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `${draft.projectId}/${draft.path}`,
          content: draft.modifiedContent,
          expectedSha256: draft.baseHash,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setReady(false);
        setError(data.error || "Apply failed");
        return;
      }

      setStatus("approved");
      setBackupId(typeof data.backup === "string" ? data.backup : "");
      sessionStorage.removeItem(draftKey(draft.projectId, draft.path));
      const verifyResponse = await fetch(`/api/files/read?path=${encodeURIComponent(`${draft.projectId}/${draft.path}`)}`);
      const verifyData = await verifyResponse.json();
      if (!verifyResponse.ok) {
        setMessage("Change was applied, but the post-write read-back could not verify the file.");
        return;
      }
      const afterHash = await sha256(verifyData.content);
      setChecksumAfter(afterHash);
      if (afterHash === data.sha256) {
        setMessage("Change applied and verified: the saved file hash matches the server response.");
      } else {
        setMessage("Warning: the saved file hash differs from the write response. Stop and inspect the file.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!draft || !backupId || (status !== "approved" && status !== "restored") || !checksumAfter || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/files/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `${draft.projectId}/${draft.path}`,
          backupId,
          expectedSha256: checksumAfter,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setReady(false);
        setError(data.error || "Restore failed");
        return;
      }
      setChecksumAfter(data.sha256);
      setBackupId(typeof data.backup === "string" ? data.backup : "");
      const nextStatus = status === "approved" ? "restored" : "approved";
      setStatus(nextStatus);
      setMessage(data.verified
        ? (nextStatus === "restored" ? "Previous version restored and hash-verified." : "Reviewed version restored again and hash-verified.")
        : "Restore completed without verification evidence.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!draft || status !== "pending" || !ready || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/files/read?path=${encodeURIComponent(`${draft.projectId}/${draft.path}`)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not verify file after rejection");
      const afterHash = await sha256(data.content);
      setChecksumAfter(afterHash);
      setStatus("rejected");
      sessionStorage.removeItem(draftKey(draft.projectId, draft.path));
      if (afterHash === draft.baseHash) {
        setMessage("Change rejected. The file's current hash matches the original hash.");
      } else {
        setMessage("Change rejected, but the file hash changed independently. Inspect the file before continuing.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to verify the file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Review proposed change</h1>
        <p className="mt-1 text-sm text-gray-600">Inspect the actual project file diff before approving or rejecting it.</p>
      </header>

      {loading && <p role="status">Loading draft and verifying the current file…</p>}
      {error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      {message && <div role="status" className="mb-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm">{message}</div>}

      {draft && (
        <>
          <div className="mb-4 rounded border border-gray-200 p-3">
            <div><strong>Project:</strong> {draft.projectId}</div>
            <div><strong>File:</strong> {draft.path}</div>
            <div><strong>Status:</strong> {status}</div>
            <div className="mt-2 break-all font-mono text-xs"><strong>Original SHA-256:</strong> {checksumBefore}</div>
            {checksumAfter && <div className="break-all font-mono text-xs"><strong>Verified SHA-256:</strong> {checksumAfter}</div>}
          </div>

          <DiffEditor original={draft.baseContent} modified={draft.modifiedContent} language={languageFor(draft.path)} height="440px" />

          <div className="mt-4 flex flex-wrap gap-3">
            {status === "pending" && (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={!ready || busy || loading}
                  className="rounded bg-green-600 px-5 py-3 font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Processing…" : "Approve & apply"}
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={!ready || busy || loading}
                  className="rounded bg-red-600 px-5 py-3 font-medium text-white disabled:opacity-50"
                >
                  Reject change
                </button>
              </>
            )}
            {(status === "approved" || status === "restored") && backupId && (
              <button
                type="button"
                onClick={handleRestore}
                disabled={busy || !checksumAfter}
                className="rounded border border-amber-500 px-5 py-3 font-medium text-amber-900 disabled:opacity-50"
              >
                {busy ? "Restoring…" : status === "approved" ? "Restore previous version" : "Reapply reviewed version"}
              </button>
            )}
            <button type="button" onClick={() => router.push(`/editor?project=${encodeURIComponent(draft.projectId)}`)} className="rounded border border-gray-300 px-5 py-3">
              Return to editor
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function draftKey(projectId: string, filePath: string): string {
  return `alex-studio-draft:${projectId}:${filePath}`;
}

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "html") return "html";
  if (extension === "css") return "css";
  if (extension === "js" || extension === "mjs") return "javascript";
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (extension === "json") return "json";
  return "plaintext";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
