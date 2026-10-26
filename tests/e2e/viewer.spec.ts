import { expect, test, type Page } from '@playwright/test';

const PADDING = 24;

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
const metrics = (page: Page) => page.evaluate(() => (window as any).__pfw.metrics);
const mounted = (page: Page) => page.locator('.page').count();

async function waitForCanvas(page: Page, n: number) {
  await page.waitForSelector(`.page[data-page="${n}"] canvas[data-rendered="true"]`);
}

/** Counts sampled non-white pixels in a canvas. */
const ink = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i]! < 200 || d[i + 1]! < 200 || d[i + 2]! < 200) n++;
    return n;
  }, selector);

test.describe('viewer', () => {
  test('renders the first page of simple.pdf quickly', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    expect((await state(page)).numPages).toBe(3);
    expect(await ink(page, '.page[data-page="1"] canvas')).toBeGreaterThan(100);
    const m = await metrics(page);
    expect(m.firstPaint - m.openStart).toBeLessThan(1000);
  });

  test('virtualises a 300 page document', async ({ page }) => {
    await open(page, 'long300.pdf');
    await waitForCanvas(page, 1);
    expect(await mounted(page)).toBeLessThanOrEqual(10);
    const m = await metrics(page);
    expect(m.firstPaint - m.openStart).toBeLessThan(1000);
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(149));
    await expect.poll(async () => (await state(page)).currentPage).toBe(150);
    await waitForCanvas(page, 150);
    expect(await mounted(page)).toBeLessThanOrEqual(10);
    expect(await ink(page, '.page[data-page="150"] canvas')).toBeGreaterThan(100);
  });

  test('centers mixed page sizes and fits the widest page to the width', async ({ page }) => {
    await open(page, 'mixed.pdf');
    await waitForCanvas(page, 1);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 0.5));
    await expect.poll(() => mounted(page)).toBe(3);
    const rects = await page.evaluate(() => {
      const layer = document.querySelector('.page-layer') as HTMLElement;
      return Array.from(document.querySelectorAll<HTMLElement>('.page')).map((p) => ({
        center: p.offsetLeft + p.offsetWidth / 2,
        width: p.offsetWidth,
        height: p.offsetHeight,
        layerWidth: layer.offsetWidth,
      }));
    });
    for (const r of rects) expect(Math.abs(r.center - r.layerWidth / 2)).toBeLessThanOrEqual(1);
    expect(rects[1]!.width).toBeGreaterThan(rects[1]!.height);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-width'));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const layer = document.querySelector('.page-layer') as HTMLElement;
          const p = document.querySelector<HTMLElement>('.page[data-page="2"]')!;
          return layer.offsetWidth - p.offsetWidth;
        }),
      )
      .toBeLessThanOrEqual(2 * PADDING + 1);
    expect((await state(page)).zoomMode).toBe('fit-width');
  });

  test('keeps the current page when zooming', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(149));
    await expect.poll(async () => (await state(page)).currentPage).toBe(150);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 2));
    await expect.poll(async () => (await state(page)).scale).toBe(2);
    expect((await state(page)).currentPage).toBe(150);
  });

  test('ctrl+wheel zooms around the cursor', async ({ page }) => {
    await open(page, 'long300.pdf');
    await waitForCanvas(page, 1);
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(10));
    await expect.poll(async () => (await state(page)).currentPage).toBe(11);
    const before = await page.evaluate(() => (window as any).__pfw.viewer.docPointAtClient(600, 400));
    const scaleBefore = (await state(page)).scale;
    await page.mouse.move(600, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await state(page)).scale).toBeGreaterThan(scaleBefore);
    const after = await page.evaluate(() => (window as any).__pfw.viewer.docPointAtClient(600, 400));
    expect(after.index).toBe(before.index);
    expect(Math.abs(after.fraction - before.fraction)).toBeLessThan(0.02);
  });

  test('rotates pages', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    await page.evaluate(() => (window as any).__pfw.viewer.setRotation(90));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const p = document.querySelector<HTMLElement>('.page[data-page="1"]')!;
          return p.offsetWidth > p.offsetHeight;
        }),
      )
      .toBe(true);
    expect((await state(page)).rotation).toBe(90);
  });

  test('renders at the device pixel ratio', async ({ page }) => {
    await open(page, 'simple.pdf');
    await waitForCanvas(page, 1);
    const r = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('.page[data-page="1"] canvas')!;
      return { backing: c.width, css: Math.round(c.clientWidth * devicePixelRatio), dpr: devicePixelRatio };
    });
    expect(Math.abs(r.backing - r.css)).toBeLessThanOrEqual(1);
  });

  test('shows an error for a broken file and stays usable', async ({ page }) => {
    await open(page, 'broken.pdf');
    expect((await state(page)).status).toBe('error');
    await expect(page.locator('.error-banner')).toBeVisible();
    await expect(page.locator('.error-banner')).toContainText('broken.pdf');
    await expect(page.getByRole('heading', { name: 'Open a PDF' })).toBeVisible();
  });

  test('prompts for a password for an encrypted file', async ({ page }) => {
    await open(page, 'encrypted.pdf');
    expect((await state(page)).status).toBe('error');
    await expect(page.getByRole('alertdialog')).toContainText('password protected');
    await expect(page.locator('.error-banner')).toBeHidden();
  });
});
