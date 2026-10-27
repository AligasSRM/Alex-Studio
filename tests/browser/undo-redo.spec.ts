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
  await expect(page.getByRole('status')).toContainText('Saved');
}

test('edit, undo, redo, branch invalidation, and save/reopen preserve the expected content', async ({ page }) => {
  const projectName = `undo-redo-${Date.now()}`;
  await page.goto('/');
  await createProject(page, projectName);

  const editor = page.getByRole('textbox', { name: 'File editor' });
  const initial = await editor.inputValue();
  const edited = '<!doctype html><html><body><h1>Edited version</h1></body></html>';

  await editor.fill(edited);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor).toHaveValue(initial);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor).toHaveValue(edited);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const branched = '<!doctype html><html><body><h1>New branch</h1></body></html>';
  await editor.fill(branched);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();

  await saveCurrentFile(page);
  await page.reload();
  await page.getByLabel('Active project').selectOption({ label: projectName });
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor' })).toHaveValue(branched);
});

test('switching files and projects restores content and resets stale undo/redo history', async ({ page }) => {
  const firstName = `history-first-${Date.now()}`;
  const secondName = `history-second-${Date.now()}`;
  await page.goto('/');
  await createProject(page, firstName);

  const editor = page.getByRole('textbox', { name: 'File editor' });
  const firstContent = '<!doctype html><html><body><h1>First project saved</h1></body></html>';
  await editor.fill(firstContent);
  await saveCurrentFile(page);

  const cssContent = 'body { background: rgb(1, 2, 3); }';
  await page.getByRole('button', { name: /styles\.css/ }).click();
  await expect(editor).toBeVisible();
  await editor.fill(cssContent);
  await saveCurrentFile(page);
  await page.getByRole('button', { name: /index\.html/ }).click();
  await expect(editor).toHaveValue(firstContent);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /styles\.css/ }).click();
  await expect(editor).toHaveValue(cssContent);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await createProject(page, secondName);
  const secondContent = '<!doctype html><html><body><h1>Second project edit</h1></body></html>';
  await editor.fill(secondContent);
  await saveCurrentFile(page);

  const projectSelect = page.getByLabel('Active project');
  await projectSelect.selectOption({ label: firstName });
  await expect(editor).toHaveValue(firstContent);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await projectSelect.selectOption({ label: secondName });
  await expect(editor).toHaveValue(secondContent);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
