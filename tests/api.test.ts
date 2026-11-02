import fs from 'node:fs';
import path from 'node:path';
import { POST as createProjectRoute } from '../app/api/projects/route';
import { GET as getFilesRoute, POST as writeFileRoute } from '../app/api/files/route';
import { GET as previewRoute } from '../app/api/preview/route';
import { getProject, listProjects } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';

const createdIds: string[] = [];
function createFixtureProject(name: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 7);
  const root = projectRoot(id);
  fs.mkdirSync(root, { recursive: true });
  const record = { id, name, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, '.alex-project.json'), JSON.stringify(record, null, 2) + '\\n');
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body><h1>' + name + '</h1><button>Try interaction</button><p>Your project is running.</p></body></html>\\n');
  fs.writeFileSync(path.join(root, 'styles.css'), 'body{font-family:system-ui}\\n');
  fs.writeFileSync(path.join(root, 'script.js'), '');
  createdIds.push(id);
  return record;
}
function localRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    },
    body: JSON.stringify(body),
  });
}
afterEach(() => {
  for (const id of createdIds.splice(0)) {
    fs.rmSync(projectRoot(id), { recursive: true, force: true });
  }
});

describe('local project API', () => {
  it('fails closed on project creation until Windows-native mutation protection exists', async () => {
    const before = fs.existsSync(path.join(process.cwd(), 'workspace')) ? fs.readdirSync(path.join(process.cwd(), 'workspace')) : [];
    const response = await createProjectRoute(localRequest('http://localhost:3000/api/projects', { name: 'API Test Project' }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/^UNAVAILABLE:/);
    const after = fs.existsSync(path.join(process.cwd(), 'workspace')) ? fs.readdirSync(path.join(process.cwd(), 'workspace')) : [];
    expect(after).toEqual(before);
  });

  it('rejects symlinked project metadata when reading project details', async () => {
    const project = createFixtureProject('Metadata Symlink Test');
    const root = projectRoot(project.id);
    const metadata = path.join(root, '.alex-project.json');
    const linkedMetadata = path.join(root, 'linked-metadata.json');
    fs.writeFileSync(linkedMetadata, JSON.stringify({ id: project.id, name: 'Forged project name', createdAt: new Date().toISOString() }));
    fs.unlinkSync(metadata);
    fs.symlinkSync(linkedMetadata, metadata);
    expect(getProject(project.id)).toBeNull();
    expect(listProjects().some((item) => item.id === project.id)).toBe(false);
  });

  it('refuses file writes without explicit approval and saves after approval', async () => {
    const project = createFixtureProject('Approval Test Project');
    const payload = { projectId: project.id, path: 'index.html', content: '<h1>Approved content</h1>' };
    const denied = await writeFileRoute(localRequest('http://localhost:3000/api/files', payload));
    expect(denied.status).toBe(409);
    const approved = await writeFileRoute(localRequest('http://localhost:3000/api/files', { ...payload, approved: true }));
    expect(approved.status).toBe(503);
    expect((await approved.json()).error).toMatch(/^UNAVAILABLE:/);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).not.toBe(payload.content);
    expect(fs.existsSync(path.join(projectRoot(project.id), '.alex', 'backups'))).toBe(false);

    const traversal = await writeFileRoute(localRequest('http://localhost:3000/api/files', {
      ...payload, path: '../outside.txt', approved: true,
    }));
    expect(traversal.status).toBe(400);
    expect(fs.existsSync(path.join(projectRoot(project.id), '..', 'outside.txt'))).toBe(false);
    expect(approved.headers.get('content-type')).toContain('application/json');
  });

  it('rejects file listing, reads, and writes for unknown project IDs', async () => {
    const projectId = 'missing-project-authorization-check';
    const list = await getFilesRoute(new Request('http://localhost:3000/api/files?projectId=' + projectId, {
      headers: { host: 'localhost:3000' },
    }));
    expect(list.status).toBe(404);

    const read = await getFilesRoute(new Request('http://localhost:3000/api/files?projectId=' + projectId + '&path=index.html', {
      headers: { host: 'localhost:3000' },
    }));
    expect(read.status).toBe(404);

    const write = await writeFileRoute(localRequest('http://localhost:3000/api/files', {
      projectId, path: 'index.html', content: '<h1>Must not be written</h1>', approved: true,
    }));
    expect(write.status).toBe(404);
  });

  it('serves the current project HTML in a restricted preview response', async () => {
    const project = createFixtureProject('Preview Test Project');
    const response = await previewRoute(new Request('http://localhost:3000/api/preview?projectId=' + encodeURIComponent(project.id), { headers: { host: 'localhost:3000' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await response.text();
    expect(html).toContain('Preview Test Project');
    expect(html).toContain('Try interaction');
    expect(html).toContain('Your project is running.');
  });

  it('rejects preview requests from non-local hosts', async () => {
    const response = await previewRoute(new Request('http://example.com/api/preview?projectId=unknown', {
      headers: { host: 'example.com' },
    }));
    expect(response.status).toBe(403);
  });

  it('rejects project creation from a non-local origin', async () => {
    const request = new Request('https://example.com/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com', host: 'example.com' },
      body: JSON.stringify({ name: 'Should Not Exist' }),
    });
    const response = await createProjectRoute(request);
    expect(response.status).toBe(403);
  });
});
