import fs from 'node:fs';
import path from 'node:path';
import * as filesModule from '../lib/files';
import { POST } from '../app/api/ai/apply/route';
import { issueVerificationProof } from '../lib/ai-verification-proof';
import { createProject } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';

const projectIds: string[] = [];
const originalIndex = '<h1>before</h1>\n';
const originalStyles = 'body { color: black; }\n';

function setupProject() {
  const project = createProject('AI Apply Route Test ' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  projectIds.push(project.id);
  fs.writeFileSync(path.join(projectRoot(project.id), 'index.html'), originalIndex);
  fs.writeFileSync(path.join(projectRoot(project.id), 'styles.css'), originalStyles);
  return project;
}

function hash(value: string) {
  return require('node:crypto').createHash('sha256').update(value, 'utf8').digest('hex') as string;
}

function makeRequest(projectId: string, files: Array<{ path: string; content: string; baseHash: string | null }>) {
  const verificationProof = issueVerificationProof(projectId, files);
  return new Request('http://localhost/api/ai/apply', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      origin: 'http://localhost',
    },
    body: JSON.stringify({ projectId, approved: true, files, verificationProof }),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  for (const id of projectIds.splice(0)) {
    fs.rmSync(projectRoot(id), { recursive: true, force: true });
  }
});

describe('AI apply route transactional behavior', () => {
  it('applies an approved batch when base hashes match', async () => {
    const project = setupProject();
    const changes = [
      { path: 'index.html', content: '<h1>after</h1>\n', baseHash: hash(originalIndex) },
      { path: 'styles.css', content: 'body { color: blue; }\n', baseHash: hash(originalStyles) },
    ];

    const response = await POST(makeRequest(project.id, changes));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, count: 2, applied: ['index.html', 'styles.css'] });
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(changes[0].content);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'styles.css'), 'utf8')).toBe(changes[1].content);
  });

  it('rejects a stale base hash without changing any file', async () => {
    const project = setupProject();
    const changes = [
      { path: 'index.html', content: '<h1>after</h1>\n', baseHash: '0'.repeat(64) },
    ];

    const response = await POST(makeRequest(project.id, changes));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/changed since the AI draft/i);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(originalIndex);
  });

  it('restores original bytes after an injected mid-batch write failure', async () => {
    const project = setupProject();
    const changes = [
      { path: 'index.html', content: '<h1>after</h1>\n', baseHash: hash(originalIndex) },
      { path: 'styles.css', content: 'body { color: blue; }\n', baseHash: hash(originalStyles) },
    ];
    const realWrite = filesModule.writeProjectFile;
    let writes = 0;
    jest.spyOn(filesModule, 'writeProjectFile').mockImplementation((...args) => {
      writes++;
      if (writes === 2) throw new Error('injected second-file write failure');
      return realWrite(...args);
    });

    const response = await POST(makeRequest(project.id, changes));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.rollback).toMatchObject({ status: 'COMPLETE', restoredPaths: ['index.html'] });
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(originalIndex);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'styles.css'), 'utf8')).toBe(originalStyles);
  });

  it('reports an incomplete rollback when restoration itself fails', async () => {
    const project = setupProject();
    const changes = [
      { path: 'index.html', content: '<h1>after</h1>\n', baseHash: hash(originalIndex) },
      { path: 'styles.css', content: 'body { color: blue; }\n', baseHash: hash(originalStyles) },
    ];
    const realWrite = filesModule.writeProjectFile;
    let writes = 0;
    jest.spyOn(filesModule, 'writeProjectFile').mockImplementation((...args) => {
      writes++;
      if (writes === 2 || writes === 3) throw new Error('injected write/restore failure');
      return realWrite(...args);
    });

    const response = await POST(makeRequest(project.id, changes));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.rollback).toMatchObject({ status: 'INCOMPLETE', failedPaths: ['index.html'] });
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(changes[0].content);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'styles.css'), 'utf8')).toBe(originalStyles);
  });
});
