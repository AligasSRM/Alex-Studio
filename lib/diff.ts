import { diffLines } from 'diff';

export function computeDiff(before: string, after: string) {
  const changes = diffLines(before, after);
  let added = 0;
  let removed = 0;

  changes.forEach((part) => {
    if (part.added) added += part.value.split('\n').length - 1;
    if (part.removed) removed += part.value.split('\n').length - 1;
  });

  return {
    changes,
    added,
    removed,
  };
}
