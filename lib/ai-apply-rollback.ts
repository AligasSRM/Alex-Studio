export type ApplySnapshot = { path: string; content: string | null };

/**
 * Restores only changes that were applied, in reverse order.
 * Returns paths whose restore operation failed so callers can report partial recovery.
 */
export function rollbackAppliedSnapshots(
  snapshots: ApplySnapshot[],
  appliedPaths: string[],
  restore: (snapshot: ApplySnapshot) => void,
): string[] {
  const applied = new Set(appliedPaths);
  const failures: string[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    if (!applied.has(snapshot.path)) continue;
    try {
      restore(snapshot);
    } catch {
      failures.push(snapshot.path);
    }
  }
  return failures;
}
