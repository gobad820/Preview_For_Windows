import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}

/** Loads the empty window and waits until the app has booted. */
async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__pfw?.store);
}

const bg = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('theme and type', () => {
  test('UI text is set in the bundled Inter at 13px', async ({ page }) => {
    await boot(page);
    const faces = await page.evaluate(async () => {
      const loaded = await document.fonts.load('13px Inter');
      return loaded.map((f) => ({ family: f.family.replace(/"/g, ''), status: f.status }));
    });
    expect(faces).toContainEqual({ family: 'Inter', status: 'loaded' });
    const body = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { family: s.fontFamily, size: s.fontSize };
    });
    expect(body.family.replace(/"/g, '')).toMatch(/^Inter,/);
    expect(body.size).toBe('13px');
  });

  test('light palette: calm gray document area under near-white chrome', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);
    expect(await bg(page, '#viewer')).toBe('rgb(232, 232, 232)');
    expect(await bg(page, '#toolbar')).toBe('rgb(246, 246, 246)');
  });

  test('dark palette follows the OS and an explicit data-theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await boot(page);
    expect(await bg(page, '#viewer')).toBe('rgb(30, 30, 30)');
    expect(await bg(page, '#toolbar')).toBe('rgb(44, 44, 46)');
    await page.evaluate(() => (document.documentElement.dataset['theme'] = 'light'));
    expect(await bg(page, '#viewer')).toBe('rgb(232, 232, 232)');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => (document.documentElement.dataset['theme'] = 'dark'));
    expect(await bg(page, '#viewer')).toBe('rgb(30, 30, 30)');
  });

  test('mica turns chrome translucent and keeps the document area opaque', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, 'simple.pdf');
    await page.evaluate(() => {
      document.documentElement.dataset['material'] = 'mica';
      (window as any).__pfw.store.set({ sidebarOpen: true });
    });
    expect(await bg(page, '#toolbar')).toBe('rgba(246, 246, 246, 0.6)');
    expect(await bg(page, '#sidebar')).toBe('rgba(246, 246, 246, 0.6)');
    expect(await bg(page, 'body')).toBe('rgba(0, 0, 0, 0)');
    expect(await bg(page, '#viewer')).toBe('rgb(232, 232, 232)');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await bg(page, '#toolbar')).toBe('rgba(32, 32, 32, 0.55)');
    expect(await bg(page, '#viewer')).toBe('rgb(30, 30, 30)');
  });
});

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());

test.describe('unified toolbar', () => {
  test('is a 52px window drag region whose controls are not', async ({ page }) => {
    await open(page, 'simple.pdf');
    const bar = page.locator('#toolbar');
    expect((await bar.boundingBox())!.height).toBe(52);
    await expect(bar).toHaveAttribute('data-tauri-drag-region', '');
    await expect(page.locator('#toolbar .tb-title')).toHaveAttribute('data-tauri-drag-region', '');
    const draggableControls = await page.evaluate(
      () => document.querySelectorAll('#toolbar button[data-tauri-drag-region], #toolbar input[data-tauri-drag-region]').length,
    );
    expect(draggableControls).toBe(0);
  });

  test('without a document the title is Preview and the subtitle is hidden', async ({ page }) => {
    await boot(page);
    await expect(page.locator('[data-doc-title]')).toHaveText('Preview');
    await expect(page.locator('[data-doc-edited]')).toBeHidden();
    await expect(page.locator('.tb-subtitle')).toBeHidden();
  });

  test('shows the file name, Page N of M and — Edited while dirty', async ({ page }) => {
    await open(page, '한글 문서.pdf');
    await expect(page.locator('[data-doc-title]')).toHaveText('한글 문서.pdf');
    const subtitle = page.locator('.tb-subtitle');
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toContainText('Page');
    await expect(subtitle.locator('[data-page-total]')).toHaveText(String((await state(page)).numPages));
    await expect(subtitle.locator('input[data-page-input]')).toHaveValue('1');
    await expect(page.locator('[data-doc-edited]')).toBeHidden();
    await page.evaluate(() => (window as any).__pfw.store.set({ dirty: true }));
    await expect(page.locator('[data-doc-edited]')).toBeVisible();
    await expect(page.locator('[data-doc-edited]')).toHaveText('— Edited');
    await page.evaluate(() => (window as any).__pfw.store.set({ dirty: false }));
    await expect(page.locator('[data-doc-edited]')).toBeHidden();
  });

  test('zoom pill opens a radio menu that toggles closed from the pill', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 1.25));
    const pill = page.locator('[data-zoom-menu]');
    await expect(pill).toHaveText('125%');
    await pill.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio').locator('.menu-label')).toHaveText([
      'Fit Width', 'Fit Page', '50%', '75%', '100%', '125%', '150%', '200%', '400%',
    ]);
    await expect(menu.getByRole('menuitemradio', { name: '125%' })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemradio', { name: '100%' })).toHaveAttribute('aria-keyshortcuts', 'Ctrl+0');
    await expect(menu.getByRole('menuitemradio', { name: 'Fit Width' })).toHaveAttribute('aria-checked', 'false');
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    await pill.click();
    await expect(menu).toHaveCount(0);
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
  });

  test('the ⋯ button opens the App menu at the button', async ({ page }) => {
    await open(page, 'simple.pdf');
    const more = page.locator('#toolbar [data-action="more"]');
    await more.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Open…' })).toBeVisible();
    const b = (await more.boundingBox())!;
    const m = (await menu.boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(b.y + b.height);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('the search button turns into a find field inside the toolbar', async ({ page }) => {
    await open(page, 'simple.pdf');
    const find = page.locator('#toolbar [data-action="find"]');
    await expect(page.locator('#toolbar #findbar')).toHaveCount(1);
    await expect(page.locator('#findbar')).toBeHidden();
    await find.click();
    await expect(page.locator('#findbar')).toBeVisible();
    await expect(find).toBeHidden();
    await expect(page.locator('#findbar input[data-find-input]')).toBeFocused();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const field = (await page.locator('#findbar .find-field').boundingBox())!;
    expect(Math.round(field.width)).toBe(220);
    expect(Math.round(field.height)).toBe(28);
    await page.keyboard.press('Escape');
    await expect(page.locator('#findbar')).toBeHidden();
    await expect(find).toBeVisible();
  });

  test('has no caption buttons in the browser', async ({ page }) => {
    await open(page, 'simple.pdf');
    await expect(page.locator('[data-window]')).toHaveCount(0);
  });

  test('caption buttons drive platform window controls', async ({ page }) => {
    await open(page, 'simple.pdf');
    // The browser host has no window controls: rebuild the toolbar in place with a fake set.
    await page.evaluate(() => {
      const w = window as any;
      const calls: string[] = (w.__calls = []);
      let notify: (m: boolean) => void = () => {};
      const controls = {
        minimize: async () => void calls.push('minimize'),
        toggleMaximize: async () => void calls.push('toggleMaximize'),
        close: async () => void calls.push('close'),
        isMaximized: async () => false,
        onMaximizedChange: (cb: (m: boolean) => void) => {
          notify = cb;
          return () => {};
        },
      };
      w.__setMaximized = (m: boolean) => notify(m);
      const old = w.__pfw.toolbar;
      old.destroy();
      w.__pfw.toolbar = new old.constructor(document.getElementById('toolbar'), w.__pfw.store, old.actions, controls);
    });
    const buttons = page.locator('#toolbar [data-window]');
    await expect(buttons).toHaveCount(3);
    expect(await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('data-window')))).toEqual([
      'minimize', 'maximize', 'close',
    ]);
    const close = (await page.locator('[data-window="close"]').boundingBox())!;
    expect(close).toMatchObject({ width: 46, height: 52 });
    expect(Math.round(close.x + close.width)).toBe(1200);
    expect(await page.locator('[data-window="close"]').evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Segoe Fluent Icons');

    await page.locator('[data-window="minimize"]').click();
    await page.locator('[data-window="maximize"]').click();
    await page.locator('[data-window="close"]').click();
    expect(await page.evaluate(() => (window as any).__calls)).toEqual(['minimize', 'toggleMaximize', 'close']);

    const max = page.locator('[data-window="maximize"]');
    await expect(max).toHaveAttribute('aria-label', 'Maximize');
    await page.evaluate(() => (window as any).__setMaximized(true));
    await expect(max).toHaveAttribute('aria-label', 'Restore');
    await expect(max).toHaveText('');
    await page.evaluate(() => (window as any).__setMaximized(false));
    await expect(max).toHaveText('');

    await page.locator('[data-window="close"]').hover();
    await expect.poll(() => page.locator('[data-window="close"]').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
      'rgb(196, 43, 28)',
    );
  });

  test('fits a 480px window without overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 600 });
    await open(page, 'simple.pdf');
    const overflow = await page.locator('#toolbar').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.locator('[data-zoom-menu]')).toBeVisible();
    await expect(page.locator('[data-action="more"]')).toBeVisible();
  });
});
