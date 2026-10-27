import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POST as createProjectRoute } from '../app/api/projects/route';
import { POST as writeFileRoute } from '../app/api/files/route';
import { projectRoot } from '../lib/path-security';

const createdIds: string[] = [];
const outsideDirs: string[] = [];

function localPost(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function createProject(name: string) {
  const response = await createProjectRoute(localPost('http://localhost:3000/api/projects', { name }));
  expect(response.status).toBe(201);
  const { project } = await response.json();
  createdIds.push(project.id as string);
  return project as { id: string; name: string };
}

afterEach(() => {
  jest.restoreAllMocks();
  for (const id of createdIds.splice(0)) fs.rmSync(projectRoot(id), { recursive: true, force: true });
  for (const dir of outsideDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Phase 0 filesystem failure and race hardening', () => {
  it('keeps the original bytes and removes the temporary file when atomic rename fails', async () => {
    const project = await createProject(`P0 rename failure ${Date.now()}`);
    const root = projectRoot(project.id);
    const target = path.join(root, 'index.html');
    const original = fs.readFileSync(target);
    const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Injected rename failure'), { code: 'EIO' });
    });

    const response = await writeFileRoute(localPost('http://localhost:3000/api/files', {
      projectId: project.id, path: 'index.html', content: '<h1>must not partially apply</h1>', approved: true,
    }));

    expect(rename).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
    expect(fs.readFileSync(target)).toEqual(original);
    expect(fs.readdirSync(root).some(name => name.startsWith('.alex-tmp-'))).toBe(false);
    const backups = path.join(root, '.alex', 'backups');
    expect(fs.readdirSync(backups)).toHaveLength(1);
    expect(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]))).toEqual(original);
  });

  it('replaces a target swapped to a symlink without modifying the outside sentinel', async () => {
    const project = await createProject(`P0 target symlink race ${Date.now()}`);
    const root = projectRoot(project.id);
    const target = path.join(root, 'index.html');
    const parked = path.join(root, 'index-original.html');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-target-race-'));
    outsideDirs.push(outside);
    const outsideFile = path.join(outside, 'sentinel.txt');
    const sentinel = Buffer.from('outside target must remain byte-for-byte unchanged');
    fs.writeFileSync(outsideFile, sentinel);
    const originalRename = fs.renameSync.bind(fs);
    let swapped = false;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (!swapped && String(to) === target && String(from).includes('.alex-tmp-')) {
        originalRename(target, parked);
        fs.symlinkSync(outsideFile, target, 'file');
        swapped = true;
      }
      return originalRename(from, to);
    });

    const response = await writeFileRoute(localPost('http://localhost:3000/api/files', {
      projectId: project.id, path: 'index.html', content: '<h1>safe replacement</h1>', approved: true,
    }));

    expect(swapped).toBe(true);
    expect(response.status).toBe(200);
    expect(fs.readFileSync(outsideFile)).toEqual(sentinel);
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('<h1>safe replacement</h1>');
  });
});
