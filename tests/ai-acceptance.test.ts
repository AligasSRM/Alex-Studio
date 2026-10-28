import { analyzeGeneratedProject } from '../lib/ai-acceptance';

describe('AI project acceptance preflight', () => {
  it('reports broken local links as failures with evidence', () => {
    const report = analyzeGeneratedProject([
      { path: 'index.html', content: '<html><link rel="stylesheet" href="missing.css"><img src="missing.png"></html>' },
    ], ['The home page loads styles and images.']);
    const refs = report.checks.find((check) => check.id === 'REF-LOCAL');
    expect(refs?.status).toBe('fail');
    expect(refs?.evidence).toContain('missing.css');
    expect(refs?.evidence).toContain('missing.png');
    expect(report.status).toBe('fail');
  });

  it('flags undeclared imports while keeping discovered commands unverified', () => {
    const report = analyzeGeneratedProject([
      { path: 'package.json', content: '{"scripts":{"build":"next build"}}' },
      { path: 'src/app.js', content: "import widget from 'not-declared-package';" },
    ], ['The app builds successfully.']);
    expect(report.checks.find((check) => check.id === 'DEP-DECL')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'CMD-RUN')?.status).toBe('unverified');
    expect(report.commands).toEqual([{ command: 'npm run build', status: 'unverified',
      reason: expect.stringContaining('Not executed') }]);
  });

  it('rejects malformed package.json instead of treating it as valid', () => {
    const report = analyzeGeneratedProject([
      { path: 'package.json', content: '{"dependencies":' },
      { path: 'src/app.js', content: "import widget from 'not-declared-package';" },
    ], []);
    expect(report.checks.find((check) => check.id === 'PKG-JSON')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'DEP-DECL')?.status).toBe('fail');
    expect(report.status).toBe('fail');
  });

  it('accepts declared packages and existing local resources', () => {
    const report = analyzeGeneratedProject([
      { path: 'package.json', content: '{"dependencies":{"react":"^19.0.0"}}' },
      { path: 'index.html', content: '<link rel="stylesheet" href="./styles.css"><img src="./logo.png">' },
      { path: 'styles.css', content: 'body { color: black; }' },
      { path: 'logo.png', content: 'image placeholder' },
      { path: 'src/app.js', content: "import React from 'react';" },
    ], ['The app uses its declared dependencies.']);
    expect(report.checks.find((check) => check.id === 'REF-LOCAL')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'DEP-DECL')?.status).toBe('pass');
  });

  it('never claims requirements or commands passed without execution evidence', () => {
    const report = analyzeGeneratedProject([
      { path: 'index.html', content: '<!doctype html><title>Okay</title><body>Hello</body>' },
    ], ['The page title is Okay.', 'The page has a contact form.']);
    expect(report.requirements).toHaveLength(2);
    expect(report.requirements.every((item) => item.status === 'unverified')).toBe(true);
    expect(report.checks.find((check) => check.id === 'CMD-RUN')?.status).toBe('unverified');
    expect(report.status).toBe('unverified');
  });

  it('rejects unsafe javascript URLs and non-canonical file paths', () => {
    const report = analyzeGeneratedProject([
      { path: 'index.html', content: '<a href="javascript:alert(1)">bad</a>' },
      { path: '../outside.js', content: 'bad' },
    ], []);
    expect(report.checks.find((check) => check.id === 'FILE-PATH')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'REF-LOCAL')?.status).toBe('fail');
    expect(report.requirements[0].status).toBe('unverified');
  });
});
