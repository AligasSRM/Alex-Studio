import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST as createProjectRoute } from '../app/api/projects/route';
import { POST as writeFileRoute } from '../app/api/files/route';
import { listProjects } from '../lib/project-store';
import { projectRoot } from '../lib/path-security';

const createdIds: string[] = [];
const outsideFiles: string[] = [];

function localPost(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function createTestProject(name: string) {
  const response = await createProjectRoute(localPost('http://localhost:3000/api/projects', { name }));
  expect(response.status).toBe(201);
  const { project } = await response.json();
  createdIds.push(project.id as string);
  return project as { id: string; name: string };
}

afterEach(() => {
  for (const id of createdIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  for (const file of outsideFiles.splice(0)) fs.rmSync(file, { force: true });
});

describe('Phase 0 acceptance — project lifecycle and explicit approval', () => {
  it('rediscovers project metadata and starter files through disk-backed storage', async () => {
    const project = await createTestProject(`P0 lifecycle ${Date.now()}`);
    const root = projectRoot(project.id);
    expect(listProjects()).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id, name: project.name })]));
    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toContain(project.name);
    expect(fs.existsSync(path.join(root, 'styles.css'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'script.js'))).toBe(true);
  });

  it('leaves original file bytes unchanged when approval is absent', async () => {
    const project = await createTestProject(`P0 approval denied ${Date.now()}`);
    const file = path.join(projectRoot(project.id), 'index.html');
    const before = fs.readFileSync(file);
    const response = await writeFileRoute(localPost('http://localhost:3000/api/files', {
      projectId: project.id, path: 'index.html', content: '<h1>This must not be written</h1>',
    }));
    expect(response.status).toBe(409);
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it('stores an exact byte-for-byte backup before an approved replacement', async () => {
    const project = await createTestProject(`P0 backup exact ${Date.now()}`);
    const root = projectRoot(project.id);
    const file = path.join(root, 'index.html');
    const original = fs.readFileSync(file);
    const replacement = '<!doctype html><html><body><h1>Approved replacement</h1></body></html>';
    const response = await writeFileRoute(localPost('http://localhost:3000/api/files', {
      projectId: project.id, path: 'index.html', content: replacement, approved: true,
    }));
    expect(response.status).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toBe(replacement);
    const backupDir = path.join(root, '.alex', 'backups');
    const backups = fs.readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(backupDir, backups[0]))).toEqual(original);
  });

  it('does not overwrite the original when backup creation fails', async () => {
    const project = await createTestProject(`P0 backup failure ${Date.now()}`);
    const root = projectRoot(project.id);
    const file = path.join(root, 'index.html');
    const original = fs.readFileSync(file);
    const alexDir = path.join(root, '.alex');
    const backupDir = path.join(alexDir, 'backups');
    fs.mkdirSync(alexDir, { recursive: true });
    fs.writeFileSync(backupDir, 'intentional blocker');
    const response = await writeFileRoute(localPost('http://localhost:3000/api/files', {
      projectId: project.id, path: 'index.html', content: '<h1>Must remain unapplied</h1>', approved: true,
    }));
    expect(response.status).toBe(400);
    expect(fs.readFileSync(file)).toEqual(original);
    expect(fs.readFileSync(backupDir, 'utf8')).toBe('intentional blocker');
  });

  it('rejects traversal without changing a pre-existing file outside the project', async () => {
    const project = await createTestProject(`P0 traversal ${Date.now()}`);
    const outside = path.join(path.dirname(projectRoot(project.id)), `p0-outside-${project.id}.txt`);
    const sentinel = Buffer.from('outside sentinel must remain unchanged');
    outsideFiles.push(outside);
    fs.writeFileSync(outside, sentinel);
    const response = await writeFileRoute(localPost('http://localhost:3000/api/files', {
      projectId: project.id, path: `../${path.basename(outside)}`, content: 'attempted overwrite', approved: true,
    }));
    expect(response.status).toBe(400);
    expect(fs.readFileSync(outside)).toEqual(sentinel);
  });

  it('does not create an outside file if a checked parent directory is swapped for a symlink before rename', async () => {
    const project = await createTestProject(`P0 symlink race ${Date.now()}`);
    const root = projectRoot(project.id);
    const nested = path.join(root, 'nested');
    const parked = path.join(root, 'nested-original');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-race-outside-'));
    const sentinelFile = path.join(outside, 'sentinel.txt');
    const sentinel = Buffer.from('race sentinel must remain unchanged');
    fs.mkdirSync(nested);
    fs.writeFileSync(sentinelFile, sentinel);
    const originalRename = fs.renameSync.bind(fs);
    let swapped = false;
    const renameSpy = jest.spyOn(fs, 'renameSync');
    renameSpy.mockImplementation((oldPath, newPath) => {
      const from = String(oldPath);
      const to = String(newPath);
      if (!swapped && from.includes('.alex-tmp-') && to.endsWith(path.join('nested', 'race.txt'))) {
        originalRename(nested, parked);
        fs.symlinkSync(outside, nested, 'dir');
        swapped = true;
      }
      return originalRename(oldPath, newPath);
    });

    try {
      const response = await writeFileRoute(localPost('http://localhost:3000/api/files', {
        projectId: project.id, path: 'nested/race.txt', content: 'must not escape project', approved: true,
      }));
      expect(swapped).toBe(true);
      expect(response.status).toBe(400);
      expect(fs.readFileSync(sentinelFile)).toEqual(sentinel);
      expect(fs.existsSync(path.join(outside, 'race.txt'))).toBe(false);
    } finally {
      renameSpy.mockRestore();
      if (fs.existsSync(nested) && fs.lstatSync(nested).isSymbolicLink()) fs.unlinkSync(nested);
      if (fs.existsSync(parked)) originalRename(parked, nested);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

});
