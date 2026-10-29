import { evaluateRequirements, parseBrowserSnapshot } from '../lib/ai-requirement-evidence';

describe('AI user-requirement evidence', () => {
  it('proves exact title and visible-text requirements from the browser snapshot', () => {
    const snapshot = parseBrowserSnapshot('runner output\n' + JSON.stringify({
      ok: true, title: 'Portfolio', body: 'Welcome to the portfolio', errors: [],
    }));
    const evidence = evaluateRequirements([
      'title is "Portfolio"',
      'page contains text "Welcome to the portfolio"',
      'page does not contain text "Fatal error"',
    ], snapshot);
    expect(evidence.map(item => item.status)).toEqual(['pass', 'pass', 'pass']);
    expect(evidence.every(item => item.evidence.length > 0)).toBe(true);
  });

  it('marks unmet deterministic requirements as failures', () => {
    const evidence = evaluateRequirements(
      ['title is "Expected"', 'page contains text "Missing marker"'],
      { title: 'Actual', body: 'Different content', errors: [] },
    );
    expect(evidence.map(item => item.status)).toEqual(['fail', 'fail']);
  });

  it('never guesses that unsupported natural-language requirements passed', () => {
    const evidence = evaluateRequirements(
      ['The website looks modern and professional.', 'The contact form sends email.'],
      { title: 'Contact', body: 'Contact us', errors: [] },
    );
    expect(evidence.every(item => item.status === 'unverified')).toBe(true);
  });

  it('keeps requirements unverified when no browser snapshot exists', () => {
    const evidence = evaluateRequirements(['title is "Portfolio"'], null);
    expect(evidence[0].status).toBe('unverified');
    expect(evidence[0].evidence).toContain('No parseable browser snapshot');
  });

  it('extracts only a valid browser payload from mixed Docker output', () => {
    expect(parseBrowserSnapshot('container removed\n{"title":"X","body":"Y","errors":[],"ok":true}'))
      .toEqual({ title: 'X', body: 'Y', errors: [] });
    expect(parseBrowserSnapshot('no browser output')).toBeNull();
  });
});
