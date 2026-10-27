import { expect, test } from '@playwright/test';

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/');
  await page.locator('#new-project').fill(name);
  await page.getByRole('button', { name: /Create$/ }).click();
  await expect(page.locator('.files h2')).toHaveText(name);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor' })).toBeVisible();
}

test('P0-ACC-007: rendered diff assertions cover CSS and HTML files independently', async ({ page }) => {
  const name = `p0-diff-multifile-${Date.now()}`;
  await createProject(page, name);
  const editor = page.getByRole('textbox', { name: 'File editor' });

  await page.getByRole('button', { name: /styles\.css/ }).click();
  await expect(page.locator('.editor-title h2')).toHaveText('styles.css');
  const originalCss = await editor.inputValue();
  const changedCss = '/* P0-CSS-DIFF-MARKER */\nbody { color: rgb(1, 2, 3); }';
  expect(originalCss).toContain('background:#101827');
  await editor.fill(changedCss);
  await page.getByRole('button', { name: 'Review diff', exact: true }).click();
  const modifiedCss = page.locator('.diff-shell .monaco-editor.modified-in-monaco-diff-editor .view-lines');
  const originalCssPane = page.locator('.diff-shell .monaco-editor.original-in-monaco-diff-editor .view-lines');
  await expect(modifiedCss).toContainText('P0-CSS-DIFF-MARKER');
  await expect(originalCssPane).toContainText('background:#101827');

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: /index\.html/ }).click();
  await expect(page.locator('.editor-title h2')).toHaveText('index.html');
  const originalHtml = await editor.inputValue();
  const changedHtml = '<!doctype html><html><body><h1>P0-HTML-DIFF-MARKER</h1></body></html>';
  expect(originalHtml).toContain(name);
  await editor.fill(changedHtml);
  await page.getByRole('button', { name: 'Review diff', exact: true }).click();
  await expect(page.locator('.diff-shell .monaco-editor.modified-in-monaco-diff-editor .view-lines')).toContainText('P0-HTML-DIFF-MARKER');
  await expect(page.locator('.diff-shell .monaco-editor.original-in-monaco-diff-editor .view-lines')).toContainText(name);
});

test('P0-ACC-013: preview response restricts external resource classes and form actions', async ({ page }) => {
  const name = `p0-preview-csp-${Date.now()}`;
  await createProject(page, name);
  const projectId = await page.getByLabel('Active project').inputValue();
  const response = await page.request.get(`/api/preview?projectId=${encodeURIComponent(projectId)}`);
  expect(response.status()).toBe(200);
  const csp = response.headers()['content-security-policy'];
  expect(csp).toBeTruthy();
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain('img-src data: blob:');
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("form-action 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).not.toContain('https:');
  expect(csp).not.toContain('http:');

  const externalRequests: string[] = [];
  await page.route('https://example.com/**', async route => {
    externalRequests.push(route.request().url());
    await route.abort();
  });
  const editor = page.getByRole('textbox', { name: 'File editor' });
  const hostileResources = `<!doctype html><html><head>
    <link rel="stylesheet" href="https://example.com/blocked.css">
  </head><body>
    <img src="https://example.com/blocked.png">
    <video src="https://example.com/blocked.mp4"></video>
    <iframe src="https://example.com/blocked-frame"></iframe>
    <form action="https://example.com/submit"><button type="submit">Submit blocked form</button></form>
  </body></html>`;
  await editor.fill(hostileResources);
  await page.getByRole('button', { name: 'Review & save' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve & save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.frameLocator('iframe[title="HTML preview"]').locator('body')).toBeVisible();
  await page.waitForTimeout(300);
  expect(externalRequests).toEqual([]);
});
