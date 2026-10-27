import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// The iterate endpoint is stubbed here: this proves fail-closed UI behavior, not live Docker execution.
test('AI builder prepares a multi-file draft without writes, then applies it only after verification passes', async ({ page }) => {
  const name = `ai-builder-browser-${Date.now()}`;
  await page.goto('/');
  await page.locator('#new-project').fill(name);
  await page.getByRole('button', { name: /Create$/ }).click();
  await expect(page.locator('.files h2')).toHaveText(name);

  const projectId = await page.getByLabel('Active project').inputValue();
  const indexUrl = `/api/files?projectId=${encodeURIComponent(projectId)}&path=index.html`;
  const cssUrl = `/api/files?projectId=${encodeURIComponent(projectId)}&path=styles.css`;
  const originalIndexResponse = await page.request.get(indexUrl);
  const originalCssResponse = await page.request.get(cssUrl);
  expect(originalIndexResponse.ok()).toBeTruthy();
  expect(originalCssResponse.ok()).toBeTruthy();
  const originalIndex = (await originalIndexResponse.json()).content as string;
  const originalCss = (await originalCssResponse.json()).content as string;

  const generatedIndex = '<!doctype html><html><head><title>Generated flow</title><link rel="stylesheet" href="styles.css"></head><body><h1>AI_GENERATOR_BROWSER_ACCEPTANCE</h1></body></html>';
  const generatedCss = 'body { font-family: sans-serif; background: #fafafa; } h1 { color: #123456; }';

  await page.route('**/api/ai/build', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        build: {
          summary: 'Create a connected two-file page',
          plan: ['Update the page markup', 'Add matching page styles'],
          files: [
            { path: 'index.html', content: generatedIndex, baseHash: sha256(originalIndex) },
            { path: 'styles.css', content: generatedCss, baseHash: sha256(originalCss) },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.001, monthlyCostUsd: 0.001, budgetWarning: false },
      }),
    });
  });

  let verificationAttempt = 0;
  await page.route('**/api/ai/iterate', async route => {
    verificationAttempt += 1;
    const request = route.request().postDataJSON() as { files: { path: string; content: string; baseHash: string | null }[] };
    const passed = verificationAttempt > 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: passed,
        build: { summary: passed ? 'Verified draft' : 'Unverified draft', plan: [passed ? 'Browser smoke test passed' : 'Browser smoke test failed'], files: request.files },
        diagnostic: { ok: passed, available: true, summary: passed ? 'Isolated browser test passed' : 'Isolated browser test failed', output: passed ? '{"ok":true,"title":"Generated flow","errors":[]}' : '{"ok":false,"errors":["The page body is empty"]}' },
        repairs: [],
      }),
    });
  });

  await page.locator('#ai-prompt').fill('Create a connected page with a heading and matching styles.');
  await page.getByRole('button', { name: 'Generate project draft' }).click();
  await expect(page.getByText('Proposed build — 2 file(s), not yet applied')).toBeVisible();
  await expect(page.locator('.ai-result')).toContainText('AI_GENERATOR_BROWSER_ACCEPTANCE');

  // Preparing a draft must not write either generated file.
  const indexBeforeApproval = await page.request.get(indexUrl);
  const cssBeforeApproval = await page.request.get(cssUrl);
  expect((await indexBeforeApproval.json()).content).toBe(originalIndex);
  expect((await cssBeforeApproval.json()).content).toBe(originalCss);

  const applyButton = page.getByRole('button', { name: 'Approve & apply all files' });
  await expect(applyButton).toBeDisabled();

  // A failed check must keep apply locked; only a subsequent verified pass unlocks it.
  await page.getByRole('button', { name: 'Verify & auto-repair in sandbox' }).click();
  await expect(page.locator('.ai-result')).toContainText('Isolated browser test failed');
  await expect(applyButton).toBeDisabled();

  await page.getByRole('button', { name: 'Verify & auto-repair in sandbox' }).click();
  await expect(page.locator('.ai-result')).toContainText('Isolated browser test passed');
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(page.getByRole('status')).toContainText('Applied 2 reviewed file changes.');

  // The real apply endpoint must persist both files only after the explicit approval action.
  const appliedIndexResponse = await page.request.get(indexUrl);
  const appliedCssResponse = await page.request.get(cssUrl);
  expect((await appliedIndexResponse.json()).content).toBe(generatedIndex);
  expect((await appliedCssResponse.json()).content).toBe(generatedCss);
});
