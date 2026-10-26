import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}
const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
const waitForCanvas = (page: Page, n: number) =>
  page.waitForSelector(`.page[data-page="${n}"] canvas[data-rendered="true"]`);

test.describe('review fixes', () => {
  test('encrypted files prompt for a password and open with the right one', async ({ page }) => {
    await open(page, 'encrypted.pdf');
    const panel = page.getByRole('alertdialog');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/password/i);
    const input = panel.locator('input.alert-input');
    await expect(input).toBeFocused();
    await input.fill('nope');
    await input.press('Enter');
    await expect(panel).toContainText(/incorrect/i);
    await expect(panel).toBeVisible();
    await input.fill('secret');
    await input.press('Enter');
    await expect.poll(async () => (await state(page)).status).toBe('ready');
    expect((await state(page)).numPages).toBe(1);
    await expect(panel).toBeHidden();
    await waitForCanvas(page, 1);
  });

  test('canvas backing store is capped at extreme zoom', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 8));
    await expect.poll(async () => (await state(page)).scale).toBe(8);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>('.page[data-page="1"] canvas[data-rendered="true"]');
          return c ? c.width * c.height : 0;
        }),
      )
      .toBeGreaterThan(0);
    const r = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.page[data-page="1"] canvas[data-rendered="true"]')!;
      return { pixels: c.width * c.height, css: c.clientWidth * c.clientHeight, width: c.width, cssWidth: c.clientWidth };
    });
    expect(r.pixels).toBeLessThanOrEqual(2 ** 24 + 4096);
    expect(r.css).toBeGreaterThan(r.pixels); // CSS upscales the capped bitmap
    expect(r.width).toBeLessThan(r.cssWidth);
  });

  test('arrow keys pan instead of paging when the page overflows horizontally', async ({ page }) => {
    await open(page, 'long300.pdf');
    await waitForCanvas(page, 1);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 3));
    await expect
      .poll(() => page.evaluate(() => { const v = document.getElementById('viewer')!; return v.scrollWidth > v.clientWidth; }))
      .toBe(true);
    await page.evaluate(() => { document.getElementById('viewer')!.scrollLeft = 0; });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => document.getElementById('viewer')!.scrollLeft)).toBeGreaterThan(0);
    expect((await state(page)).currentPage).toBe(1);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-width'));
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
  });

  test('opening a second file while the first is loading ends on the second', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__pfw?.app);
    await page.evaluate(() => {
      const app = (window as any).__pfw.app;
      void app.openPath('fixtures/long300.pdf');
      return app.openPath('fixtures/simple.pdf');
    });
    await expect.poll(async () => (await state(page)).fileName).toBe('simple.pdf');
    await page.waitForTimeout(500);
    expect((await state(page)).numPages).toBe(3);
    expect((await state(page)).status).toBe('ready');
    expect(await page.locator('.page').count()).toBeLessThanOrEqual(3);
  });

  test('a failed open keeps the current document and shows the error', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await page.evaluate(() => (window as any).__pfw.app.openPath('fixtures/broken.pdf'));
    await expect(page.locator('.error-banner')).toContainText('broken.pdf');
    expect((await state(page)).status).toBe('ready');
    expect((await state(page)).numPages).toBe(3);
    expect((await state(page)).fileName).toBe('simple.pdf');
    await expect(page.locator('.page[data-page="1"] canvas[data-rendered="true"]')).toHaveCount(1);
  });

  test('escape in the page input does not close the find bar', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.findBar.open());
    await expect.poll(async () => (await state(page)).findOpen).toBe(true);
    await page.locator('input[data-page-input]').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    expect((await state(page)).findOpen).toBe(true);
    await page.locator('input[data-find-input]').focus();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await state(page)).findOpen).toBe(false);
  });

  test('shows a loading cue while a document is being opened', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__pfw?.app);
    await page.evaluate(() => (window as any).__pfw.store.set({ status: 'loading' }));
    await expect(page.locator('.loading-state')).toBeVisible();
    await page.evaluate(() => (window as any).__pfw.store.set({ status: 'empty' }));
    await expect(page.locator('.loading-state')).toBeHidden();
  });
});
