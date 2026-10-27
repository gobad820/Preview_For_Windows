import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
}

test('the viewer reports page views that match the page elements', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__views = [];
    const hook = () => {
      const pfw = (window as any).__pfw;
      if (!pfw) return void setTimeout(hook, 5);
      pfw.viewer.onPageView((v: any) =>
        (window as any).__views.push({ index: v.index, width: v.viewport.width, gen: v.canvasGeneration, interactive: v.interactive, el: v.el }),
      );
    };
    hook();
  });
  await open(page, 'simple.pdf');
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
  await expect.poll(() => page.evaluate(() => (window as any).__views.some((v: any) => v.index === 0 && v.gen === 0))).toBe(true);
  const check = await page.evaluate(() => {
    const v = (window as any).__views.filter((x: any) => x.index === 0 && x.gen === 0).at(-1);
    return { width: v.width, elWidth: v.el.getBoundingClientRect().width, interactive: v.interactive, isPage: v.el.classList.contains('page') };
  });
  expect(check.isPage).toBe(true);
  expect(check.interactive).toBe(true);
  expect(Math.abs(check.width - check.elWidth)).toBeLessThan(1);

  // Zooming re-emits with the new viewport.
  const before = check.width;
  await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 2));
  await expect
    .poll(() => page.evaluate(() => (window as any).__views.filter((x: any) => x.index === 0).at(-1).width))
    .not.toBe(before);
});

test('thumbnails report views on their canvas frame', async ({ page }) => {
  await open(page, 'simple.pdf');
  await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
  await page.waitForSelector('#sidebar .thumb[data-page="1"] canvas[data-rendered="true"]');
  const v = await page.evaluate(() => {
    const view = (window as any).__pfw.sidebar.thumbnails.getPageViews().find((x: any) => x.index === 0);
    return { frame: view.el.className, width: view.viewport.width, canvas: view.el.querySelector('canvas').getBoundingClientRect().width, interactive: view.interactive };
  });
  expect(v.frame).toBe('thumb-canvas');
  expect(v.interactive).toBe(false);
  expect(Math.abs(v.width - v.canvas)).toBeLessThan(1);
});

test('toolbar order and the markup toolbar toggle', async ({ page }) => {
  await open(page, 'simple.pdf');
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#toolbar [data-action], #toolbar [data-zoom-menu]')).map(
      (el) => (el as HTMLElement).dataset['action'] ?? 'zoom-menu',
    ),
  );
  expect(order.slice(0, 2)).toEqual(['sidebar', 'view-menu']);
  const items = order.slice(2);
  expect(items.indexOf('highlight')).toBeLessThan(items.indexOf('highlight-menu'));
  expect(items.indexOf('highlight-menu')).toBeLessThan(items.indexOf('markup'));
  expect(items.indexOf('markup')).toBeLessThan(items.indexOf('zoom-out'));
  expect(items.indexOf('zoom-in')).toBeLessThan(items.indexOf('zoom-menu'));
  expect(items.indexOf('zoom-menu')).toBeLessThan(items.indexOf('rotate'));

  await expect(page.locator('#markupbar')).toBeHidden();
  await page.click('[data-action="markup"]');
  await expect(page.locator('#markupbar')).toBeVisible();
  await expect(page.locator('[data-action="markup"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-action="markup"]');
  await expect(page.locator('#markupbar')).toBeHidden();
});

test('annotation edits mark the document edited without re-rendering the canvas', async ({ page }) => {
  await open(page, 'simple.pdf');
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
  const same = await page.evaluate(async () => {
    const pfw = (window as any).__pfw;
    const canvas = document.querySelector('#viewer .page[data-page="1"] canvas');
    pfw.app.document.setAnnotations(0, [
      { id: 'x', kind: 'rect', color: '#ff0000', opacity: 1, modified: '', rect: { x0: 10, y0: 10, x1: 50, y1: 50 }, fill: null, width: 2, rounded: false },
    ]);
    await new Promise((r) => setTimeout(r, 300));
    return { same: canvas === document.querySelector('#viewer .page[data-page="1"] canvas'), dirty: pfw.store.get().dirty };
  });
  expect(same).toEqual({ same: true, dirty: true });
  await expect(page.locator('[data-doc-edited]')).toBeVisible();
});

test('every feature is a command the menus can run', async ({ page }) => {
  await open(page, 'simple.pdf');
  const r = await page.evaluate(() => {
    const app = (window as any).__pfw.app;
    const ids = app.commands.all().map((c: any) => c.id);
    const before = app.store.get().scale;
    app.commands.run('view.zoomIn');
    const zoomed = app.store.get().scale > before;
    app.commands.run('view.twoPages');
    const two = app.store.get().displayMode;
    app.commands.run('tools.rect');
    return { count: ids.length, zoomed, two, tool: app.markup.tool, markupOpen: app.store.get().markupOpen, sidebarLabel: app.commands.label('view.sidebar') };
  });
  expect(r.count).toBeGreaterThan(40);
  expect(r).toMatchObject({ zoomed: true, two: 'two-pages', tool: 'rect', markupOpen: true, sidebarLabel: 'Show Sidebar' });
});

test('the UI language follows Settings and switches live', async ({ page }) => {
  await open(page, 'simple.pdf');
  const r = await page.evaluate(() => {
    const app = (window as any).__pfw.app;
    const now = () => [app.store.get().locale, document.documentElement.lang];
    const before = now();
    app.settings.set({ language: 'ko' });
    const ko = now();
    app.settings.set({ language: 'system' });
    return { before, ko, back: now() };
  });
  // The test browser runs in English, so Automatic means English.
  expect(r).toEqual({ before: ['en', 'en'], ko: ['ko', 'ko'], back: ['en', 'en'] });
});

test('a saved language applies before the window is built', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pfw.settings', JSON.stringify({ language: 'ko' })));
  await open(page, 'simple.pdf');
  expect(await page.evaluate(() => [(window as any).__pfw.store.get().locale, document.documentElement.lang])).toEqual(['ko', 'ko']);
});
