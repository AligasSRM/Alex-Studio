import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';
import { createEditHistory, recordEdit, undoEdit, redoEdit } from '../lib/edit-history';
import { loadEditorHistory, saveEditorHistory } from '../lib/editor-history-store';

const projectIds: string[] = [];
function setupProject() {
  const project = createProject('editor-history-' + randomUUID().slice(0, 8));
  projectIds.push(project.id);
  return project;
}
afterEach(() => {
  for (const id of projectIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
});

describe('persistent editor history', () => {
  it('persists undo and redo stacks across reloads with private file permissions', () => {
    const project = setupProject();
    const initial = fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8');
    const history = recordEdit(recordEdit(createEditHistory(initial), 'version two'), 'version three');
    saveEditorHistory(project.id, 'index.html', history);
    fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), 'version three');

    const restored = loadEditorHistory(project.id, 'index.html', 'version three');
    expect(restored).toEqual(history);
    expect(undoEdit(restored).present).toBe('version two');
    expect(redoEdit(undoEdit(restored)).present).toBe('version three');

    const directory = path.join(projectRoot(project.id), '.alex', 'editor-history');
    const files = fs.readdirSync(directory);
    expect(files).toHaveLength(1);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(directory, files[0])).mode & 0o777).toBe(0o600);
  });

  it('discards unsaved draft text on reload while retaining history to the last saved version', () => {
    const project = setupProject();
    const initial = fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8');
    let history = recordEdit(createEditHistory(initial), 'saved version');
    history = recordEdit(history, 'unsaved draft');
    saveEditorHistory(project.id, 'index.html', history);
    fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), 'saved version');

    const restored = loadEditorHistory(project.id, 'index.html', 'saved version');
    expect(restored.present).toBe('saved version');
    expect(restored.past).toEqual([initial]);
    expect(restored.future).toEqual([]);
  });

  it('resets stale history when the saved file no longer belongs to its timeline', () => {
    const project = setupProject();
    const initial = fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8');
    saveEditorHistory(project.id, 'index.html', recordEdit(createEditHistory(initial), 'edited draft'));
    const restored = loadEditorHistory(project.id, 'index.html', 'external newer content');
    expect(restored).toEqual(createEditHistory('external newer content'));
  });

  it('rejects oversized stacks and history payloads that exceed the storage bound', () => {
    const project = setupProject();
    expect(() => saveEditorHistory(project.id, 'index.html', { past: Array.from({ length: 101 }, () => 'x'), present: 'now', future: [] })).toThrow(/invalid editor history/i);
    expect(() => saveEditorHistory(project.id, 'index.html', { past: [], present: 'x'.repeat(17 * 1024 * 1024), future: [] })).toThrow(/safe storage limit/i);
  });
});
