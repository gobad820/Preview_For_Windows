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
