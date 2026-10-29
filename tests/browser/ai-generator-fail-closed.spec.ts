import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

// This is a UI fail-closed test: a mocked "ok" diagnostic without a server-issued
// verification proof must never unlock the real apply endpoint.
test('AI draft remains unapplicable without a server-issued verification proof', async ({ page }) => {
  const name = 'ai-fail-closed-' + Date.now();
  await page.goto('/');
  await page.locator('#new-project').fill(name);
  await page.getByRole('button', { name: /Create$/ }).click();
  await expect(page.locator('.files h2')).toHaveText(name);

  const projectId = await page.getByLabel('Active project').inputValue();
  const indexUrl = '/api/files?projectId=' + encodeURIComponent(projectId) + '&path=index.html';
  const cssUrl = '/api/files?projectId=' + encodeURIComponent(projectId) + '&path=styles.css';
  const originalIndex = (await (await page.request.get(indexUrl)).json()).content as string;
  const originalCss = (await (await page.request.get(cssUrl)).json()).content as string;

  const generatedIndex = '<!doctype html><html><head><title>Fail closed</title><link rel="stylesheet" href="styles.css"></head><body><h1>UNVERIFIED_PROOF_TEST</h1></body></html>';
  const generatedCss = 'body { color: #123456; }';

  await page.route('**/api/ai/build', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        build: {
          summary: 'Prepare a two-file draft',
          plan: ['Update HTML', 'Update CSS'],
          requirements: ['Show the heading', 'Load the stylesheet'],
          files: [
            { path: 'index.html', content: generatedIndex, baseHash: sha256(originalIndex) },
            { path: 'styles.css', content: generatedCss, baseHash: sha256(originalCss) },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.001, monthlyCostUsd: 0.001, budgetWarning: false },
      }),
    });
  });

  await page.route('**/api/ai/iterate', async route => {
    const request = route.request().postDataJSON() as { files: { path: string; content: string; baseHash: string | null }[] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        build: { summary: 'Mocked successful diagnostic', plan: ['Browser check passed'], requirements: ['Show the heading'], files: request.files },
        diagnostic: { ok: true, available: true, summary: 'Mocked browser and command checks passed', output: 'mocked pass' },
        commandChecks: { status: 'PASS', summary: 'Mocked command checks passed', commands: [] },
        acceptance: { status: 'unverified', requirements: [], checks: [], commands: [] },
        repairs: [],
        // Intentionally omit verificationProof: the server must issue it.
      }),
    });
  });

  await page.locator('#ai-prompt').fill('Create a two-file page with a heading and stylesheet.');
  await page.getByRole('button', { name: 'Generate project draft' }).click();
  await expect(page.getByText('Proposed build — 2 file(s), not yet applied')).toBeVisible();

  const applyButton = page.getByRole('button', { name: 'Approve & apply all files' });
  await expect(applyButton).toBeDisabled();

  await page.getByRole('button', { name: 'Verify & auto-repair in sandbox' }).click();
  await expect(page.locator('.ai-result')).toContainText('Mocked browser and command checks passed');
  await expect(applyButton).toBeDisabled();

  // Neither draft generation nor an untrusted "ok: true" response may mutate files.
  expect((await (await page.request.get(indexUrl)).json()).content).toBe(originalIndex);
  expect((await (await page.request.get(cssUrl)).json()).content).toBe(originalCss);
});
