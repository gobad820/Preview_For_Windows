import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}
const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());

test.describe('toolbar', () => {
  test('page input navigates and clamps', async ({ page }) => {
    await open(page, 'long300.pdf');
    await expect(page.locator('[data-page-total]')).toHaveText('300');
    const input = page.locator('input[data-page-input]');
    await input.fill('150');
    await input.press('Enter');
    await expect.poll(async () => (await state(page)).currentPage).toBe(150);
    await input.fill('999');
    await input.press('Enter');
    await expect.poll(async () => (await state(page)).currentPage).toBe(300);
    await expect(input).toHaveValue('300');
    // Escape reverts and blurs without navigating.
    await input.fill('7');
    await input.press('Escape');
    await expect(input).toHaveValue('300');
    await expect(input).not.toBeFocused();
    expect((await state(page)).currentPage).toBe(300);
  });

  test('zoom buttons and menu', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 1));
    await expect(page.locator('[data-zoom-menu]')).toHaveText('100%');
    await page.locator('[data-action="zoom-in"]').click();
    await expect(page.locator('[data-zoom-menu]')).toHaveText('110%');
    await page.locator('[data-action="zoom-out"]').click();
    await page.locator('[data-action="zoom-out"]').click();
    await expect(page.locator('[data-zoom-menu]')).toHaveText('90%');
    await page.locator('[data-zoom-menu]').click();
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Fit Page' }).click();
    await expect.poll(async () => (await state(page)).zoomMode).toBe('fit-page');
    await expect(page.locator('[data-zoom-menu]')).toHaveText('Fit Page');
    await expect(page.locator('[role="menu"]')).toBeHidden();
    await page.locator('[data-zoom-menu]').click();
    await page.getByRole('menuitem', { name: '200%' }).click();
    await expect.poll(async () => (await state(page)).scale).toBe(2);
    expect((await state(page)).zoomMode).toBe('custom');
  });

  test('rotate, sidebar and find buttons update state', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.locator('[data-action="rotate"]').click();
    await expect.poll(async () => (await state(page)).rotation).toBe(90);
    await page.locator('[data-action="sidebar"]').click();
    await expect.poll(async () => (await state(page)).sidebarOpen).toBe(true);
    await page.locator('[data-action="sidebar"]').click();
    await expect.poll(async () => (await state(page)).sidebarOpen).toBe(false);
    await page.locator('[data-action="find"]').click();
    await expect.poll(async () => (await state(page)).findOpen).toBe(true);
  });

  test('controls are disabled without a document', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Open a PDF' })).toBeVisible();
    await expect(page.locator('input[data-page-input]')).toBeDisabled();
    await expect(page.locator('[data-action="zoom-in"]')).toBeDisabled();
    await expect(page.locator('[data-action="rotate"]')).toBeDisabled();
  });

  test('title shows a non-ASCII file name', async ({ page }) => {
    await open(page, '한글 문서.pdf');
    await expect(page).toHaveTitle('한글 문서.pdf');
    expect((await state(page)).fileName).toBe('한글 문서.pdf');
  });

  test('open button uses a file chooser', async ({ page }) => {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#toolbar [data-action="open"]').click();
    const fc = await chooser;
    await fc.setFiles(fileURLToPath(new URL('../fixtures/simple.pdf', import.meta.url)));
    await expect.poll(async () => (await state(page)).numPages).toBe(3);
    await expect(page).toHaveTitle('simple.pdf');
    await page.waitForSelector('.page[data-page="1"] canvas[data-rendered="true"]');
  });
});
