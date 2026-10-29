import { rollbackAppliedSnapshots, type ApplySnapshot } from '../lib/ai-apply-rollback';

describe('AI batch rollback reporting', () => {
  const snapshots: ApplySnapshot[] = [
    { path: 'index.html', content: 'before-index' },
    { path: 'styles.css', content: null },
    { path: 'app.js', content: 'before-app' },
  ];

  it('restores only applied files in reverse order', () => {
    const restored: string[] = [];
    const failures = rollbackAppliedSnapshots(snapshots, ['index.html', 'styles.css'], (snapshot) => {
      restored.push(snapshot.path);
    });
    expect(restored).toEqual(['styles.css', 'index.html']);
    expect(failures).toEqual([]);
  });

  it('returns every path whose rollback fails without stopping later restorations', () => {
    const attempted: string[] = [];
    const failures = rollbackAppliedSnapshots(snapshots, ['index.html', 'styles.css', 'app.js'], (snapshot) => {
      attempted.push(snapshot.path);
      if (snapshot.path === 'styles.css' || snapshot.path === 'index.html') {
        throw new Error('simulated restore failure');
      }
    });
    expect(attempted).toEqual(['app.js', 'styles.css', 'index.html']);
    expect(failures).toEqual(['styles.css', 'index.html']);
  });

  it('does not attempt rollback for paths that were never applied', () => {
    const restored: string[] = [];
    const failures = rollbackAppliedSnapshots(snapshots, [], (snapshot) => restored.push(snapshot.path));
    expect(restored).toEqual([]);
    expect(failures).toEqual([]);
  });
});
