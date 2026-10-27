import { createEditHistory, recordEdit, undoEdit, redoEdit } from '../lib/edit-history';

describe('editor undo/redo history', () => {
  it('undoes and redoes edits in order', () => {
    let h = createEditHistory('a');
    h = recordEdit(h, 'ab');
    h = recordEdit(h, 'abc');
    h = undoEdit(h);
    expect(h.present).toBe('ab');
    h = undoEdit(h);
    expect(h.present).toBe('a');
    h = redoEdit(h);
    expect(h.present).toBe('ab');
    h = redoEdit(h);
    expect(h.present).toBe('abc');
  });
  it('clears redo history after a new edit', () => {
    let h = recordEdit(recordEdit(createEditHistory('a'), 'ab'), 'abc');
    h = undoEdit(h);
    h = recordEdit(h, 'new');
    expect(h.present).toBe('new');
    expect(redoEdit(h)).toEqual(h);
  });
  it('does not add duplicate values and caps undo history', () => {
    let h = createEditHistory('0');
    expect(recordEdit(h, '0')).toEqual(h);
    for (let i = 1; i <= 120; i++) h = recordEdit(h, String(i));
    expect(h.past).toHaveLength(100);
    expect(h.present).toBe('120');
  });
  it('keeps boundary operations safe', () => {
    const h = createEditHistory('unchanged');
    expect(undoEdit(h)).toEqual(h);
    expect(redoEdit(h)).toEqual(h);
  });
});
