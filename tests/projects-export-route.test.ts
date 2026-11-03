import fs from 'node:fs';
import path from 'node:path';
import { GET } from '../app/api/projects/export/route';
import { WORKSPACE_ROOT } from '../lib/path-security';
import { projectRoot } from '../lib/path-security';

const ids: string[] = [];
afterEach(() => {
  for (const id of ids.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
});

describe('project ZIP export route', () => {
  it('returns a downloadable ZIP and excludes secret and internal files', async () => {
    const projectId = 'export-route-' + Date.now().toString(36) + '-' + ids.length;
    const root = path.join(WORKSPACE_ROOT, projectId);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, '.alex-project.json'), JSON.stringify({ id: projectId, name: 'Export Route Test', createdAt: new Date().toISOString() }));
    const project = { id: projectId };
    ids.push(project.id);
    fs.writeFileSync(path.join(projectRoot(project.id), 'secrets.txt'), 'must-not-export');
    fs.writeFileSync(path.join(projectRoot(project.id), '.env'), 'API_KEY=must-not-export');
    const response = await GET(new Request(
      'http://localhost/api/projects/export?projectId=' + encodeURIComponent(project.id),
      { headers: { host: 'localhost' } },
    ));
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename=/);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(bytes.toString('latin1')).not.toContain('must-not-export');
    expect(bytes.toString('latin1')).not.toContain('API_KEY');
  });

  it('rejects non-local requests', async () => {
    const response = await GET(new Request(
      'https://example.com/api/projects/export?projectId=missing',
      { headers: { host: 'example.com' } },
    ));
    expect(response.status).toBe(403);
  });
});
