import fs from 'node:fs';
import path from 'node:path';
import { POST as createProjectRoute } from '../app/api/projects/route';
import { POST as writeFileRoute } from '../app/api/files/route';
import { GET as previewRoute } from '../app/api/preview/route';
import { projectRoot } from '../lib/path-security';

const createdIds: string[] = [];
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
  it('creates a project with starter files', async () => {
    const response = await createProjectRoute(localRequest('http://localhost:3000/api/projects', { name: 'API Test Project' }));
    if (response.status !== 201) throw new Error('Project creation failed: ' + await response.clone().text());
    expect(response.status).toBe(201);
    const data = await response.json();
    const id = data.project.id as string;
    createdIds.push(id);
    expect(fs.existsSync(path.join(projectRoot(id), 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot(id), 'styles.css'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot(id), 'script.js'))).toBe(true);
  });

  it('refuses file writes without explicit approval and saves after approval', async () => {
    const created = await createProjectRoute(localRequest('http://localhost:3000/api/projects', { name: 'Approval Test Project' }));
    if (created.status !== 201) throw new Error('Project creation failed: ' + await created.clone().text());
    const { project } = await created.json();
    createdIds.push(project.id);
    const payload = { projectId: project.id, path: 'index.html', content: '<h1>Approved content</h1>' };
    const denied = await writeFileRoute(localRequest('http://localhost:3000/api/files', payload));
    expect(denied.status).toBe(409);
    const approved = await writeFileRoute(localRequest('http://localhost:3000/api/files', { ...payload, approved: true }));
    expect(approved.status).toBe(200);
    expect(fs.readFileSync(path.join(projectRoot(project.id), 'index.html'), 'utf8')).toBe(payload.content);
    const backupDir = path.join(projectRoot(project.id), '.alex', 'backups');
    const backups = fs.readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(backupDir, backups[0]), 'utf8')).toContain('Approval Test Project');

    const traversal = await writeFileRoute(localRequest('http://localhost:3000/api/files', {
      ...payload, path: '../outside.txt', approved: true,
    }));
    expect(traversal.status).toBe(400);
    expect(fs.existsSync(path.join(projectRoot(project.id), '..', 'outside.txt'))).toBe(false);
    expect(approved.headers.get('content-type')).toContain('application/json');
  });

  it('serves the current project HTML in a restricted preview response', async () => {
    const created = await createProjectRoute(localRequest('http://localhost:3000/api/projects', { name: 'Preview Test Project' }));
    const { project } = await created.json();
    createdIds.push(project.id);
    const response = await previewRoute(new Request('http://localhost:3000/api/preview?projectId=' + encodeURIComponent(project.id)));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await response.text();
    expect(html).toContain('Preview Test Project');
    expect(html).toContain('Try interaction');
    expect(html).toContain('Your project is running.');
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
