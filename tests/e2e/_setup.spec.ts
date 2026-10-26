import { expect, test } from '@playwright/test';

test('shell loads with the empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Preview');
  await expect(page.getByRole('heading', { name: 'Open a PDF' })).toBeVisible();
});

test('fixtures and pdf.js assets are served', async ({ request }) => {
  const pdf = await request.get('/fixtures/simple.pdf');
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  const cmap = await request.get('/pdfjs/cmaps/UniKS-UCS2-H.bcmap');
  expect(cmap.ok()).toBe(true);
  // Only cmaps, standard_fonts and wasm are exposed; anything else falls through to the SPA.
  const missing = await request.get('/pdfjs/build/pdf.mjs');
  expect(missing.headers()['content-type'] ?? '').not.toContain('javascript');
});
