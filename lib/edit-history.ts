export type EditHistory = { past: string[]; present: string; future: string[] };
const MAX_HISTORY = 100;
export function createEditHistory(value: string): EditHistory { return { past: [], present: value, future: [] }; }
export function recordEdit(history: EditHistory, value: string): EditHistory {
  if (value === history.present) return history;
  return { past: [...history.past, history.present].slice(-MAX_HISTORY), present: value, future: [] };
}
export function undoEdit(history: EditHistory): EditHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future].slice(0, MAX_HISTORY) };
}
export function redoEdit(history: EditHistory): EditHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present].slice(-MAX_HISTORY), present: history.future[0], future: history.future.slice(1) };
}
