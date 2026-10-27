import { expect, test, type Page } from '@playwright/test';

async function createProject(page: Page, name: string) {
  await page.locator('#new-project').fill(name);
  await page.getByRole('button', { name: /Create$/ }).click();
  await expect(page.locator('.files h2')).toHaveText(name);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor' })).toBeVisible();
}

async function saveCurrentFile(page: Page) {
  await page.getByRole('button', { name: 'Review & save' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve & save' }).click();
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

test('P0-ACC-004/005/006: diff review is shown and remains read-only', async ({ page }) => {
  await page.goto('/');
  await createProject(page, `p0-diff-${Date.now()}`);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  const original = await editor.inputValue();
  const modified = '<!doctype html><html><body><h1>Diff acceptance marker</h1></body></html>';
  await editor.fill(modified);
  await page.getByRole('button', { name: 'Review diff', exact: true }).click();
  await expect(page.locator('.diff-shell .monaco-diff-editor')).toBeVisible();
  const inputAreas = page.locator('.diff-shell textarea.inputarea');
  await expect.poll(async () => inputAreas.count()).toBeGreaterThan(0);
  expect(await inputAreas.evaluateAll(nodes => nodes.every(node => (node as HTMLTextAreaElement).readOnly))).toBe(true);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(editor).toHaveValue(modified);
  expect(await editor.inputValue()).not.toBe(original);
});

test('P0-ACC-009: cancelling approval leaves the saved file unchanged', async ({ page }) => {
  await page.goto('/');
  await createProject(page, `p0-cancel-${Date.now()}`);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  const original = await editor.inputValue();
  await editor.fill('<!doctype html><html><body><h1>Cancelled change</h1></body></html>');
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
