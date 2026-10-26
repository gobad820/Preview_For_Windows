import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
  await page.waitForSelector('.page[data-page="1"] canvas[data-rendered="true"]');
}
const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
const scrollTop = (page: Page) => page.evaluate(() => document.getElementById('viewer')!.scrollTop);

test.describe('keyboard shortcuts', () => {
  test('navigation keys', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.keyboard.press('End');
    await expect.poll(async () => (await state(page)).currentPage).toBe(300);
    await page.keyboard.press('Home');
    await expect.poll(async () => (await state(page)).currentPage).toBe(1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await state(page)).currentPage).toBe(1);

    const before = await scrollTop(page);
    const viewport = await page.evaluate(() => document.getElementById('viewer')!.clientHeight);
    await page.keyboard.press('Space');
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + viewport * 0.8);
    const afterSpace = await scrollTop(page);
    await page.keyboard.press('Shift+Space');
    await expect.poll(() => scrollTop(page)).toBeLessThan(afterSpace - viewport * 0.8);
    await page.keyboard.press('PageDown');
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + viewport * 0.8);
  });

  test('zoom, rotate, sidebar, find and go-to keys', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Control+0');
    await expect.poll(async () => (await state(page)).scale).toBe(1);
    expect((await state(page)).zoomMode).toBe('custom');
    await page.keyboard.press('Control+=');
    await expect.poll(async () => (await state(page)).scale).toBe(1.1);
    await page.keyboard.press('Control+-');
    await expect.poll(async () => (await state(page)).scale).toBe(1);
    await page.keyboard.press('Control+2');
    await expect.poll(async () => (await state(page)).zoomMode).toBe('fit-page');
    await page.keyboard.press('Control+1');
    await expect.poll(async () => (await state(page)).zoomMode).toBe('fit-width');
    await page.keyboard.press('Control+l');
    await expect.poll(async () => (await state(page)).rotation).toBe(90);
    await page.keyboard.press('Control+Shift+l');
    await expect.poll(async () => (await state(page)).rotation).toBe(0);
    await page.keyboard.press('Control+Alt+s');
    await expect.poll(async () => (await state(page)).sidebarOpen).toBe(true);
    await page.keyboard.press('Control+g');
    await expect(page.locator('input[data-page-input]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('input[data-page-input]')).not.toBeFocused();
    await page.keyboard.press('Control+f');
    await expect.poll(async () => (await state(page)).findOpen).toBe(true);
  });

  test('space inside the page input types instead of scrolling', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.locator('input[data-page-input]').focus();
    const before = await scrollTop(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    expect(await scrollTop(page)).toBe(before);
  });

  test('restores the last page, zoom and rotation per file', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(41));
    await expect.poll(async () => (await state(page)).currentPage).toBe(42);
    await page.keyboard.press('Control+l');
    await page.keyboard.press('Control+0');
    await expect.poll(async () => (await state(page)).rotation).toBe(90);
    await page.waitForTimeout(500); // debounced save
    await page.reload();
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    await expect.poll(async () => (await state(page)).currentPage).toBe(42);
    expect((await state(page)).rotation).toBe(90);
    expect((await state(page)).zoomMode).toBe('custom');
    expect((await state(page)).scale).toBe(1);
  });

  test('a different file starts fresh', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Control+l');
    await page.waitForTimeout(500);
    await open(page, 'mixed.pdf');
    expect((await state(page)).rotation).toBe(0);
    expect((await state(page)).currentPage).toBe(1);
  });
});
