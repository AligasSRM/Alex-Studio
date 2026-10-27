import { spawn } from 'node:child_process';
import dns from 'node:dns';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function createProject(page: Page, name: string) {
  await page.locator('#new-project').fill(name);
  await page.getByRole('button', { name: /Create$/ }).click();
  await expect(page.locator('.files h2')).toHaveText(name);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor' })).toBeVisible();
}

async function saveCurrentFile(page: Page) {
  await page.getByRole('button', { name: 'Review diff first' }).click();
  await expect(page.locator('.diff-shell .monaco-diff-editor')).toBeVisible();
  await page.getByRole('button', { name: "I've reviewed this diff" }).click();
  await page.getByRole('button', { name: 'Review & save' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve & save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Saved');
}

test('P0-ACC-001: project can be switched away from and reopened with saved files intact', async ({ page }) => {
  const firstName = `p0-reopen-first-${Date.now()}`;
  const secondName = `p0-reopen-second-${Date.now()}`;
  await page.goto('/');
  await createProject(page, firstName);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  const firstContent = '<!doctype html><html><body><h1>First project acceptance</h1></body></html>';
  await editor.fill(firstContent);
  await saveCurrentFile(page);
  await createProject(page, secondName);
  await page.getByLabel('Active project').selectOption({ label: firstName });
  await expect(editor).toHaveValue(firstContent);
  const response = await page.request.get('/api/projects');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.projects).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: firstName }),
    expect.objectContaining({ name: secondName }),
  ]));
});

test('P0-ACC-004/005/006: diff shows the edited content, rejects keyboard edits, and submits the exact draft', async ({ page }) => {
  const name = `p0-diff-${Date.now()}`;
  await page.goto('/');
  await createProject(page, name);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  const original = await editor.inputValue();
  const modified = '<!doctype html><html><body><h1>Diff acceptance marker</h1></body></html>';
  let savePayload: Record<string, unknown> | undefined;
  page.on('request', request => {
    if (request.url().endsWith('/api/files') && request.method() === 'POST') {
      savePayload = request.postDataJSON() as Record<string, unknown>;
    }
  });
  await editor.fill(modified);
  await page.getByRole('button', { name: 'Review diff', exact: true }).click();
  await expect(page.locator('.diff-shell .monaco-diff-editor')).toBeVisible();
  const modifiedLines = page.locator('.diff-shell .monaco-editor.modified-in-monaco-diff-editor .view-lines');
  const originalLines = page.locator('.diff-shell .monaco-editor.original-in-monaco-diff-editor .view-lines');
  await expect(modifiedLines).toContainText('Diff acceptance marker');
  await expect(originalLines).toContainText(name);
  await page.locator('.diff-shell .monaco-editor').last().click({ position: { x: 80, y: 50 } });
  await page.keyboard.press('Control+A');
  await page.keyboard.type('UNAUTHORIZED_DIFF_EDIT');
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(editor).toHaveValue(modified);
  expect(await editor.inputValue()).not.toBe(original);
  await saveCurrentFile(page);
  expect(savePayload).toMatchObject({ path: 'index.html', content: modified, approved: true });
});

test('P0-ACC-003: a failed project creation shows an error and preserves the current selection', async ({ page }) => {
  await page.goto('/');
  const projectSelect = page.getByLabel('Active project');
  await expect(projectSelect).toBeVisible();
  const selectedBefore = await projectSelect.inputValue();
  const headingBefore = await page.locator('.files h2').innerText();
  await page.route('**/api/projects', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected create failure' }) });
    } else {
      await route.continue();
    }
  });
  await page.locator('#new-project').fill(`p0-failed-create-${Date.now()}`);
  await page.getByRole('button', { name: /Create$/ }).click();
  await expect(page.locator('p.alert.error')).toContainText('Injected create failure');
  expect(await projectSelect.inputValue()).toBe(selectedBefore);
  await expect(page.locator('.files h2')).toHaveText(headingBefore);
});

test('P0-ACC-007: changed files can each be reviewed independently', async ({ page }) => {
  await page.goto('/');
  await createProject(page, `p0-multifile-${Date.now()}`);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  await editor.fill('<!doctype html><html><body><h1>HTML file review</h1></body></html>');
  await saveCurrentFile(page);

  await page.getByRole('button', { name: /styles\.css/ }).click();
  await expect(page.locator('.editor-title h2')).toHaveText('styles.css');
  await expect(editor).toContainText('background:#101827');
  await editor.fill('body { background: rgb(8, 9, 10); }');
  await page.getByRole('button', { name: 'Review diff', exact: true }).click();
  await expect(page.locator('.diff-shell .monaco-diff-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await saveCurrentFile(page);

  await page.getByRole('button', { name: /index\.html/ }).click();
  await expect(page.locator('.editor-title h2')).toHaveText('index.html');
  await expect(editor).toContainText('HTML file review');
  await editor.fill('<!doctype html><html><body><h1>Second HTML review</h1></body></html>');
  await page.getByRole('button', { name: 'Review diff', exact: true }).click();
  await expect(page.locator('.diff-shell .monaco-diff-editor')).toBeVisible();
});

test('P0-ACC-009: cancelling approval leaves the saved file unchanged', async ({ page }) => {
  await page.goto('/');
  await createProject(page, `p0-cancel-${Date.now()}`);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  const original = await editor.inputValue();
  await editor.fill('<!doctype html><html><body><h1>Cancelled change</h1></body></html>');
  await page.getByRole('button', { name: 'Review diff first' }).click();
  await expect(page.locator('.diff-shell .monaco-diff-editor')).toBeVisible();
  await page.getByRole('button', { name: "I've reviewed this diff" }).click();
  await page.getByRole('button', { name: 'Review & save' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor' })).toHaveValue(original);
});

test('P0-ACC-012/013: preview cannot access the parent document or make external fetches', async ({ page }) => {
  await page.goto('/');
  await createProject(page, `p0-preview-isolation-${Date.now()}`);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  const hostile = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <h1>Isolation test</h1><script>
      try {
        window.parent.document.documentElement.setAttribute('data-preview-pwned', 'yes');
        document.body.setAttribute('data-parent-access', 'allowed');
      } catch (error) { document.body.setAttribute('data-parent-access', 'blocked'); }
      fetch('https://example.com/').then(() => document.body.setAttribute('data-network', 'allowed'))
        .catch(() => document.body.setAttribute('data-network', 'blocked'));
    </script>
  </body></html>`;
  await editor.fill(hostile);
  await saveCurrentFile(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const frame = page.frameLocator('iframe[title="HTML preview"]');
  await expect(frame.locator('body')).toHaveAttribute('data-parent-access', 'blocked');
  await expect(frame.locator('body')).toHaveAttribute('data-network', 'blocked');
  await expect(page.locator('html')).not.toHaveAttribute('data-preview-pwned', 'yes');
});

test('P0-ACC-014: preview sandbox blocks top-level navigation initiated by project content', async ({ page }) => {
  await page.goto('/');
  await createProject(page, `p0-preview-navigation-${Date.now()}`);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  await editor.fill('<!doctype html><html><body><form action="https://example.com/" target="_top"><button type="submit">Try top navigation</button></form></body></html>');
  await saveCurrentFile(page);
  const before = page.url();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.frameLocator('iframe[title="HTML preview"]').getByRole('button', { name: 'Try top navigation' }).click();
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
});


test('P0-ACC-002: saved project content survives a real production-server restart', async () => {
  test.setTimeout(90_000);
  const port = 3101 + (process.pid % 1000);
  const previousDnsOrder = dns.getDefaultResultOrder();
  dns.setDefaultResultOrder('ipv4first');
  const origin = `http://localhost:${port}`;
  const startServer = async () => {
    const child = spawn(process.execPath, [
      path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start', '--hostname', '127.0.0.1', '--port', String(port),
    ], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let startupOutput = '';
    child.stdout?.on('data', chunk => { startupOutput += chunk.toString(); });
    child.stderr?.on('data', chunk => { startupOutput += chunk.toString(); });
    try {
      await expect.poll(async () => {
        try { return (await fetch(`${origin}/api/projects`, { headers: { origin } })).status; } catch { return 0; }
      }, { timeout: 35_000 }).toBe(200);
      return child;
    } catch (error) {
      child.kill('SIGKILL');
      throw new Error(`Production server failed to start. Output: ${startupOutput}\nCause: ${String(error)}`);
    }
  };
  const stopServer = async (child: ReturnType<typeof spawn>) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 3_000); }),
    ]);
    if (timer) clearTimeout(timer);
    if (!graceful && child.exitCode === null && child.signalCode === null) {
      const forcedExit = once(child, 'exit');
      child.kill('SIGKILL');
      await forcedExit;
    }
  };

  let server: ReturnType<typeof spawn> | undefined;
  let projectId: string | undefined;
  const projectName = `p0-restart-${Date.now()}`;
  try {
    server = await startServer();
    const created = await fetch(`${origin}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ name: projectName }),
    });
    expect(created.status).toBe(201);
    const createdData = await created.json() as { project: { id: string } };
    projectId = createdData.project.id;
    const savedContent = '<!doctype html><html><body><h1>Survives server restart</h1></body></html>';
    const write = await fetch(`${origin}/api/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ projectId, path: 'index.html', content: savedContent, approved: true }),
    });
    expect(write.status).toBe(200);
    await stopServer(server);
    server = undefined;

    server = await startServer();
    const projectsResponse = await fetch(`${origin}/api/projects`, { headers: { origin } });
    expect(projectsResponse.status).toBe(200);
    const projectsData = await projectsResponse.json() as { projects: Array<{ id: string; name: string }> };
    expect(projectsData.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: projectId, name: projectName }),
    ]));
    const fileResponse = await fetch(`${origin}/api/files?projectId=${encodeURIComponent(projectId!)}&path=index.html`, { headers: { origin } });
    expect(fileResponse.status).toBe(200);
    const fileData = await fileResponse.json() as { content: string };
    expect(fileData.content).toBe(savedContent);
  } finally {
    if (server) await stopServer(server);
    if (projectId) fs.rmSync(path.join(process.cwd(), 'workspace', projectId), { recursive: true, force: true });
    dns.setDefaultResultOrder(previousDnsOrder);
  }
});

test('P0-ACC-003: a failed initial project-list load shows a visible error without selecting a project', async ({ page }) => {
  await page.route('**/api/projects', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected project-list failure' }) });
    } else {
      await route.continue();
    }
  });
  await page.goto('/');
  await expect(page.locator('p.alert.error')).toContainText('Injected project-list failure');
  await expect(page.locator('.files h2')).toHaveText('No project selected');
});


test('P0-ACC-003: failed project-file loading preserves the previously active workspace', async ({ page }) => {
  await page.goto('/');
  const projectSelect = page.getByLabel('Active project');
  await createProject(page, `p0-load-first-${Date.now()}`);
  const firstName = await page.locator('.files h2').innerText();
  const firstId = await projectSelect.inputValue();
  const editor = page.getByRole('textbox', { name: 'File editor' });
  await editor.fill('<!doctype html><html><body><h1>First saved project</h1></body></html>');
  await saveCurrentFile(page);

  await createProject(page, `p0-load-second-${Date.now()}`);
  const secondName = await page.locator('.files h2').innerText();
  const secondId = await projectSelect.inputValue();
  const secondContent = '<!doctype html><html><body><h1>Second saved project</h1></body></html>';
  await editor.fill(secondContent);
  await saveCurrentFile(page);

  await page.route('**/api/files*', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.searchParams.get('projectId') === firstId && !url.searchParams.has('path')) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected project-file load failure' }) });
    } else {
      await route.continue();
    }
  });
  await projectSelect.selectOption({ label: firstName });
  await expect(page.locator('p.alert.error')).toContainText('Injected project-file load failure');
  await expect(projectSelect).toHaveValue(secondId);
  await expect(page.locator('.files h2')).toHaveText(secondName);
  await expect(editor).toHaveValue(secondContent);
});
