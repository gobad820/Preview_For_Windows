import { expect, test, type Locator, type Page } from '@playwright/test';

// Same open/state helpers as viewer.spec.ts (kept local so the two specs stay independent).
async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());

async function waitForCanvas(page: Page, n: number) {
  await page.waitForSelector(`.page[data-page="${n}"] canvas[data-rendered="true"]`);
}

/** Opens the bar through the component API; the Ctrl+F binding belongs to the shortcuts task. */
const openFind = (page: Page) => page.evaluate(() => (window as any).__pfw.findBar.open());

const input = (page: Page): Locator => page.locator('#findbar input[data-find-input]');
const count = (page: Page): Locator => page.locator('#findbar [data-find-count]');
const current = (page: Page): Locator => page.locator('.textLayer mark.find-current');
const marks = (page: Page): Locator => page.locator('.textLayer mark.find-match');

test.describe('find bar', () => {
  test('open() shows the bar and focuses the input', async ({ page }) => {
    await open(page, 'simple.pdf');
    await expect(page.locator('#findbar')).toBeHidden();
    await openFind(page);
    await expect(page.locator('#findbar')).toBeVisible();
    await expect(input(page)).toBeFocused();
    expect((await state(page)).findOpen).toBe(true);
    await expect(count(page)).toHaveText('');
  });

  test('finds, highlights and navigates matches in simple.pdf', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await openFind(page);

    // "page 2" occurs twice on page 2 (title + body line); the first hit becomes current.
    await input(page).fill('page 2');
    await expect(count(page)).toHaveText('1 of 2');
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveText('page 2');
    await expect(marks(page)).toHaveCount(2);
    expect(await state(page)).toMatchObject({ findQuery: 'page 2', findTotal: 2, findIndex: 0 });

    // A new query drops the old highlights and starts from the first match again.
    await input(page).fill('hello');
    await expect(count(page)).toHaveText('1 of 3');
    await expect.poll(async () => (await state(page)).currentPage).toBe(1);
    await expect(current(page)).toHaveText('Hello');
    expect(await page.locator('.textLayer mark', { hasText: 'page 2' }).count()).toBe(0);

    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('2 of 3');
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
    expect((await state(page)).findIndex).toBe(1);

    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('3 of 3');
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('1 of 3'); // wraps around

    await page.keyboard.press('Shift+Enter');
    await expect(count(page)).toHaveText('3 of 3'); // wraps backwards
    await page.keyboard.press('Shift+Enter');
    await expect(count(page)).toHaveText('2 of 3');
    await page.keyboard.press('Shift+Enter');
    await expect(count(page)).toHaveText('1 of 3');
    await expect.poll(async () => (await state(page)).currentPage).toBe(1);
    await expect(current(page)).toHaveCount(1);
  });

  test('Escape closes the bar and removes every highlight', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await openFind(page);
    await input(page).fill('hello');
    await expect(count(page)).toHaveText('1 of 3');
    await expect(marks(page)).not.toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#findbar')).toBeHidden();
    await expect(page.locator('.textLayer mark')).toHaveCount(0);
    expect(await state(page)).toMatchObject({ findOpen: false, findQuery: '', findTotal: 0, findIndex: -1 });
    // The text layer text itself is untouched.
    await expect(page.locator('.page[data-page="1"] .textLayer span', { hasText: 'Hello world page 1' })).toHaveCount(1);
  });

  test('re-applies highlights when a text layer is rebuilt after zooming', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await openFind(page);
    await input(page).fill('fox');
    await expect(count(page)).toHaveText('1 of 3');
    await expect(page.locator('.page[data-page="1"] mark.find-current')).toHaveCount(1);

    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 1.5));
    await expect.poll(async () => (await state(page)).scale).toBe(1.5);
    // The zoomed page gets a fresh text layer; marks must come back on it.
    await expect(page.locator('.page[data-page="1"] mark.find-current')).toHaveCount(1);
    await expect(page.locator('.page[data-page="1"] mark.find-current')).toHaveText('fox');
    await expect(count(page)).toHaveText('1 of 3');
  });

  test('searches Korean text and reports no results', async ({ page }) => {
    await open(page, '한글 문서.pdf');
    await waitForCanvas(page, 1);
    await openFind(page);
    await input(page).fill('미리보기');
    await expect(count(page)).toHaveText('1 of 2');
    await expect(current(page)).toHaveText('미리보기');

    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('2 of 2');
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);

    await input(page).fill('zzzz');
    await expect(count(page)).toHaveText('No results');
    await expect(page.locator('.textLayer mark')).toHaveCount(0);
    expect(await state(page)).toMatchObject({ findQuery: 'zzzz', findTotal: 0, findIndex: -1 });

    await input(page).fill('   ');
    await expect(count(page)).toHaveText('');
  });

  test('reopening keeps the previous query and runs it again', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await openFind(page);
    await input(page).fill('fixture');
    await expect(count(page)).toHaveText('1 of 3');
    await page.keyboard.press('Escape');
    await expect(page.locator('#findbar')).toBeHidden();

    await openFind(page);
    await expect(input(page)).toHaveValue('fixture');
    await expect(input(page)).toBeFocused();
    await expect(count(page)).toHaveText('1 of 3');
    await expect(current(page)).toHaveCount(1);
  });

  test('prev/next/close buttons work with the mouse', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await openFind(page);
    await input(page).fill('dog');
    await expect(count(page)).toHaveText('1 of 3');
    await page.locator('#findbar [data-action="find-next"]').click();
    await expect(count(page)).toHaveText('2 of 3');
    await page.locator('#findbar [data-action="find-prev"]').click();
    await expect(count(page)).toHaveText('1 of 3');
    await expect(input(page)).toBeFocused();
    await page.locator('#findbar [data-action="find-close"]').click();
    await expect(page.locator('#findbar')).toBeHidden();
    expect((await state(page)).findOpen).toBe(false);
  });
});
