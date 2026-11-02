function isSensitiveSegment(segment: string): boolean {
  const name = segment.toLowerCase();
  return segment.startsWith('.') ||
    name.startsWith('credentials') ||
    name.startsWith('secret') ||
    name.startsWith('id_rsa') ||
    name.startsWith('id_ed25519') ||
    name === 'node_modules';
}

/** Return only files safe to materialize in the isolated browser/build sandbox. */
export function filterSandboxFiles(
  files: ReadonlyMap<string, string>,
  secretPaths: ReadonlySet<string>,
): Map<string, string> {
  return new Map(Array.from(files.entries()).filter(([filePath]) => {
    const segments = filePath.split('/');
    return !segments.some(isSensitiveSegment) && !secretPaths.has(filePath);
  }));
}
