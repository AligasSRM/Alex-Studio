import fs from 'node:fs';
import { POST as buildPost } from '../app/api/ai/build/route';
import { POST as iteratePost } from '../app/api/ai/iterate/route';
import { POST as applyPost } from '../app/api/ai/apply/route';
import { POST as createProjectPost } from '../app/api/projects/route';
import { projectRoot } from '../lib/path-security';
import { readProjectFile } from '../lib/files';
import { resetRateLimitsForTests } from '../lib/rate-limit';

const projectIds: string[] = [];
const lifecycleTest = process.env.RUN_FULL_AI_LIFECYCLE === '1' ? it : it.skip;
const expectedTitle = 'Alex Studio Lifecycle Proof';
const expectedMarker = 'AI_LIFECYCLE_MARKER';

function localPost(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function makeProject() {
  const response = await createProjectPost(localPost(
    'http://localhost:3000/api/projects',
    { name: 'Full AI Lifecycle Proof ' + Date.now() },
  ));
  if (!response.ok) throw new Error('Could not create a clean integration-test project');
  const data = await response.json() as { project: { id: string } };
  projectIds.push(data.project.id);
  return data.project.id;
}

afterEach(() => {
  jest.restoreAllMocks();
  resetRateLimitsForTests();
  for (const id of projectIds.splice(0)) {
    fs.rmSync(projectRoot(id), { recursive: true, force: true });
  }
});

describe('full AI lifecycle proof (real provider and real Docker; explicitly gated)', () => {
  lifecycleTest('generates a draft, proves requirements, repairs a broken draft, and applies only the verified files', async () => {
    const provider = process.env.AI_PROVIDER === 'groq' ? 'groq' : 'openai';
    const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error(provider === 'groq' ? 'GROQ_API_KEY is required' : 'OPENAI_API_KEY is required');
    if (!process.env.AI_RUNNER_DOCKER_IMAGE) throw new Error('AI_RUNNER_DOCKER_IMAGE must name the approved digest-pinned runner image');

    const id = await makeProject();
    const original = readProjectFile(id, 'index.html');
    const prompt = [
      'Build a tiny static HTML page with document title "' + expectedTitle + '".',
      'The visible page body must contain the exact text "' + expectedMarker + '".',
      'Return index.html only; no network requests, external assets, forms, or JavaScript are needed.',
    ].join(' ');

    const buildResponse = await buildPost(localPost('http://localhost:3000/api/ai/build', {
      projectId: id, prompt, approved: true,
    }));
    if (!buildResponse.ok) {
      const error = await buildResponse.json().catch(() => ({})) as { error?: string };
      throw new Error('Real AI build failed (' + buildResponse.status + '): ' + (error.error ?? 'unknown error'));
    }
    const buildData = await buildResponse.json() as {
      build: { files: { path: string; content: string; baseHash: string | null }[] };
    };
    const index = buildData.build.files.find(file => file.path === 'index.html');
    if (!index) throw new Error('AI build did not return index.html');
    if (!index.content.includes(expectedMarker)) throw new Error('AI build omitted the requested marker before the repair test could begin');

    // Deliberately break only the in-memory draft. The saved project must remain unchanged.
    const brokenFiles = buildData.build.files.map(file => file.path === 'index.html'
      ? { ...file, content: file.content.replace(expectedMarker, 'AI_LIFECYCLE_BROKEN') }
      : file);
    expect(readProjectFile(id, 'index.html')).toBe(original);

    const requirements = [
      'title is "' + expectedTitle + '"',
      'page contains text "' + expectedMarker + '"',
    ];
    const iterateResponse = await iteratePost(localPost('http://localhost:3000/api/ai/iterate', {
      projectId: id, prompt, files: brokenFiles, requirements, approved: true,
    }));
    const iterateData = await iterateResponse.json() as {
      ok?: boolean;
      error?: string;
      verificationProof?: string | null;
      repairs?: { round: number; summary: string }[];
      diagnostic?: { summary: string; output: string };
      acceptance?: { requirements: { id: string; text: string; status: string; evidence: string }[] };
      build?: { files: { path: string; content: string; baseHash: string | null }[] };
    };
    expect(iterateResponse.status).toBe(200);
    expect(iterateData.ok).toBe(true);
    expect(iterateData.repairs?.length).toBeGreaterThanOrEqual(1);
    expect(iterateData.verificationProof).toEqual(expect.any(String));
    console.log('AI_LIFECYCLE_REQUIREMENT_EVIDENCE ' + JSON.stringify({
      commitSha: process.env.GITHUB_SHA ?? null,
      runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? (process.env.GITHUB_SERVER_URL ?? 'https://github.com') + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID
        : null,
      repairRounds: iterateData.repairs?.map(item => ({ round: item.round, summary: item.summary })),
      requirements: iterateData.acceptance?.requirements,
    }));
    expect(iterateData.acceptance?.requirements.map(item => item.status)).toEqual(['pass', 'pass']);
    expect(iterateData.acceptance?.requirements.every(item => item.evidence.length > 0)).toBe(true);
    expect(readProjectFile(id, 'index.html')).toBe(original);

    const finalFiles = iterateData.build?.files ?? [];
    expect(finalFiles.some(file => file.path === 'index.html' && file.content.includes(expectedMarker))).toBe(true);
    const applyResponse = await applyPost(localPost('http://localhost:3000/api/ai/apply', {
      projectId: id,
      files: finalFiles,
      approved: true,
      verificationProof: iterateData.verificationProof,
    }));
    const applyData = await applyResponse.json() as { ok?: boolean; error?: string; count?: number };
    expect(applyResponse.status).toBe(200);
    expect(applyData.ok).toBe(true);
    expect(applyData.count).toBeGreaterThan(0);

    const applied = readProjectFile(id, 'index.html');
    expect(applied).toMatch(new RegExp('<title>\\s*' + expectedTitle + '\\s*</title>', 'i'));
    expect(applied).toContain(expectedMarker);
    expect(applied).not.toContain('AI_LIFECYCLE_BROKEN');
    console.log('AI_LIFECYCLE_FINAL_RESULT ' + JSON.stringify({
      commitSha: process.env.GITHUB_SHA ?? null,
      runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? (process.env.GITHUB_SERVER_URL ?? 'https://github.com') + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID
        : null,
      result: 'PASS', appliedCount: applyData.count,
      verifiedTitle: expectedTitle, verifiedMarker: expectedMarker,
    }));
  }, 8 * 60 * 1000);
});
