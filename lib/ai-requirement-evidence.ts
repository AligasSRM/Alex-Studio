export type BrowserSnapshot = {
  title: string;
  body: string;
  errors: string[];
};

export type RequirementEvidence = {
  id: string;
  requirement: string;
  status: 'pass' | 'fail' | 'unverified';
  method: string;
  evidence: string;
};

export function parseBrowserSnapshot(output: string): BrowserSnapshot | null {
  const lines = output.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (typeof value.title !== 'string' || typeof value.body !== 'string' || !Array.isArray(value.errors)) continue;
      return {
        title: value.title,
        body: value.body,
        errors: value.errors.filter((item): item is string => typeof item === 'string').slice(0, 50),
      };
    } catch {
      // Docker diagnostics can contain unrelated JSON; keep searching for the runner payload.
    }
  }
  return null;
}

/**
 * Prove only explicit, deterministic assertions supported by the browser evidence.
 * Natural-language or unsupported requirements remain UNVERIFIED; they are never guessed.
 *
 * Supported requirement syntax:
 *   title is "Exact document title"
 *   page contains text "Visible text"
 *   page does not contain text "Forbidden visible text"
 */
export function evaluateRequirements(
  requested: unknown,
  snapshot: BrowserSnapshot | null | undefined,
): RequirementEvidence[] {
  const requirements = Array.isArray(requested)
    ? requested.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 20)
    : [];

  return requirements.map((raw, index) => {
    const requirement = raw.trim().slice(0, 500);
    const id = 'REQ-' + String(index + 1).padStart(3, '0');
    const match = requirement.match(/^(?:TEST:\\s*)?(?:page\\s+)?title\\s+is\\s+["'](.+)["']$/i)
      ?? requirement.match(/^(?:TEST:\\s*)?page\\s+contains\\s+text\\s+["'](.+)["']$/i)
      ?? requirement.match(/^(?:TEST:\\s*)?page\\s+does\\s+not\\s+contain\\s+text\\s+["'](.+)["']$/i);

    if (!match) {
      return { id, requirement, status: 'unverified', method: 'unsupported-assertion', evidence: 'No deterministic assertion matches the supported requirement syntax; manual review or a dedicated test is required.' };
    }
    if (!snapshot) {
      return { id, requirement, status: 'unverified', method: 'isolated-browser', evidence: 'No parseable browser snapshot was returned; this requirement was not verified.' };
    }

    const isTitle = /title\\s+is/i.test(requirement.replace(/^TEST:\\s*/i, ''));
    const isNegativeText = /does\\s+not\\s+contain\\s+text/i.test(requirement);
    const expected = match[1];
    const actual = isTitle ? snapshot.title : snapshot.body;
    const passed = isTitle ? actual === expected : isNegativeText ? !actual.includes(expected) : actual.includes(expected);
    const method = isTitle ? 'document.title' : 'visible-body-text';
    return {
      id, requirement, status: passed ? 'pass' : 'fail', method,
      evidence: passed
        ? (isTitle ? 'Observed document title exactly matches: ' : isNegativeText ? 'Forbidden text is absent from the visible body: ' : 'Expected text is present in the visible body: ') + JSON.stringify(expected)
        : (isTitle ? 'Expected document title ' : isNegativeText ? 'Forbidden text was found in the visible body: ' : 'Expected text was not found in the visible body: ') + JSON.stringify(expected) + '; observed ' + JSON.stringify(actual.slice(0, 1000)),
    };
  });
}
