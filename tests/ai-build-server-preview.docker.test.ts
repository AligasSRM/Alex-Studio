import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runBuildServerPreview } from '../lib/ai-build-server-preview';

const enabled = process.env.RUN_DOCKER_INTEGRATION === '1';
const describeDocker = enabled ? describe : describe.skip;
const roots: string[] = [];

function fixture(startScript = 'node server.js') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-build-preview-test-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'alex-build-preview-fixture', version: '1.0.0',
    scripts: {
      build: "node -e \"require('node:fs').mkdirSync('dist',{recursive:true});require('node:fs').writeFileSync('dist/index.html','<!doctype html><html><head><title>Built Preview</title></head><body><main>Server preview acceptance</main></body></html>')\"",
      start: startScript,
    },
  }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'alex-build-preview-fixture', version: '1.0.0', lockfileVersion: 3,
    packages: { '': { name: 'alex-build-preview-fixture', version: '1.0.0' } },
  }));
  fs.writeFileSync(path.join(root, 'server.js'), `const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const root=path.resolve('dist');http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\\/+/,'' )||'index.html');if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html')){res.writeHead(403).end();return;}try{res.setHeader('content-type','text/html; charset=utf-8');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end('not found');}}).listen(4173,'127.0.0.1');`);
  return root;
}

function runnerContainers(): string[] {
  return execFileSync('docker', ['ps', '-a', '--filter', 'name=alex-studio-preview-', '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 5000 }).trim().split('\\n').filter(Boolean);
}

afterAll(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describeDocker('real Docker build + server preview acceptance', () => {
  beforeAll(() => {
    if (!process.env.AI_RUNNER_NPM_CACHE || !path.isAbsolute(process.env.AI_RUNNER_NPM_CACHE)) {
      throw new Error('A pre-populated absolute AI_RUNNER_NPM_CACHE is required.');
    }
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 10000 });
  });

  it('builds an npm project, starts its server, checks it in Playwright, and removes the container', async () => {
    const before = new Set(runnerContainers());
    const result = await runBuildServerPreview(fixture());
    if (!result.ok) throw new Error('Build/server preview failed: ' + JSON.stringify(result, null, 2));
    expect(result.status).toBe('PASS');
    expect(result.pageSnapshot).toMatchObject({ title: 'Built Preview' });
    expect(result.pageSnapshot?.body).toContain('Server preview acceptance');
    expect(result.cleanupVerified).toBe(true);
    expect(runnerContainers().filter(name => !before.has(name))).toEqual([]);
  }, 150000);

  it('fails closed when the server exits before readiness and still verifies cleanup', async () => {
    const before = new Set(runnerContainers());
    const result = await runBuildServerPreview(fixture('node -e "process.exit(7)"'));
    expect(result.ok).toBe(false);
    expect(result.status).toBe('FAIL');
    expect(result.cleanupVerified).toBe(true);
    expect(runnerContainers().filter(name => !before.has(name))).toEqual([]);
  }, 150000);
});
