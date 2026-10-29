'use client';

import { useCallback, useEffect, useState } from 'react';

type Batch = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  status: 'started' | 'applied' | 'rolling-back' | 'rolled-back' | 'rollback-failed';
  paths: string[];
  rollbackError?: string;
};

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function AIApplyHistory({ projectId, refreshKey, onRolledBack }: {
  projectId: string;
  refreshKey: number;
  onRolledBack: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyBatch, setBusyBatch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    if (!projectId) { setBatches([]); return; }
    setLoading(true);
    try {
      const data = await request('/api/ai/apply/history?projectId=' + encodeURIComponent(projectId));
      setBatches(data.batches || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load AI apply history');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  async function rollback(batch: Batch) {
    const files = batch.paths.join(', ');
    if (!window.confirm('Roll back this applied AI batch? The current files must still match the batch output. Files: ' + files)) return;
    setBusyBatch(batch.batchId);
    setError('');
    setNotice('');
    try {
      const data = await request('/api/ai/apply/rollback', {
        method: 'POST',
        body: JSON.stringify({ projectId, batchId: batch.batchId, approved: true }),
      });
      setNotice('Batch rolled back. Restored: ' + (data.restoredPaths || []).join(', '));
      await refresh();
      onRolledBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed');
      await refresh();
    } finally {
      setBusyBatch('');
    }
  }

  return <section className="panel ai-history" aria-labelledby="ai-apply-history-title">
    <div className="ai-heading">
      <div><p className="eyebrow">CHANGE RECOVERY</p><h3 id="ai-apply-history-title">AI apply history</h3></div>
      <button type="button" className="secondary" onClick={() => void refresh()} disabled={loading || !!busyBatch}>Refresh</button>
    </div>
    <p className="muted">Private before/after snapshots are stored in project metadata. Rollback is available only while every affected file still matches that batch&apos;s applied output; newer edits are never overwritten.</p>
    {error && <p className="alert error" role="alert">{error}</p>}
    {notice && <p className="alert success" role="status">{notice}</p>}
    {loading ? <p>Loading history…</p> : !batches.length ? <p className="muted">No AI apply batches recorded for this project.</p> :
      <ul className="ai-batch-list">{batches.map(batch => <li key={batch.batchId}>
        <div><strong>{batch.status.replace('-', ' ')}</strong><small>{new Date(batch.createdAt).toLocaleString()}</small><small>{batch.paths.join(', ')}</small>{batch.rollbackError && <small className="alert error">{batch.rollbackError}</small>}</div>
        {(batch.status === 'applied' || batch.status === 'rollback-failed' || batch.status === 'rolling-back') && <button type="button" className="secondary" disabled={!!busyBatch} onClick={() => void rollback(batch)}>{busyBatch === batch.batchId ? 'Rolling back…' : batch.status === 'applied' ? 'Roll back batch' : 'Retry rollback'}</button>}
      </li>)}</ul>}
  </section>;
}
