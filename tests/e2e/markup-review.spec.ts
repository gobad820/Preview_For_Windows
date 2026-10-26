import { expect, test, type Page } from '@playwright/test';

/** Regression tests for the final review of the markup branch. */

async function open(page: Page, name = 'simple.pdf') {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
}

async function settle(page: Page) {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const v = (window as any).__pfw.viewer.getPageViews().find((x: any) => x.index === 0);
          const el = document.querySelector('#viewer .page[data-page="1"]');
          if (!v || !el) return '';
          const r = el.getBoundingClientRect();
          return Math.abs(v.viewport.width - r.width) < 1 ? `${r.x},${r.y},${r.width},${r.height}` : '';
        });
        const stable = now !== '' && now === last;
        last = now;
        return stable;
      },
      { intervals: [150] },
    )
    .toBe(true);
}

/** Markup toolbar shown, Fit Page, layout settled. */
async function openFit(page: Page) {
  await open(page);
  await page.click('#toolbar [data-action="markup"]');
  await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-page'));
  await settle(page);
}

async function at(page: Page, fx: number, fy: number) {
  const box = (await page.locator('#viewer .page[data-page="1"]').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

const toPdf = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const view = (window as any).__pfw.viewer.getPageViews().find((v: any) => v.index === 0);
    const r = view.el.getBoundingClientRect();
    const [px, py] = view.viewport.convertToPdfPoint(x - r.left, y - r.top);
    return { x: px, y: py };
  }, p);

/** Page 1's box in PDF space. */
const pageBox = (page: Page) =>
  page.evaluate(() => {
    const vp = (window as any).__pfw.viewer.getPageViews().find((v: any) => v.index === 0).viewport;
    const [ax, ay] = vp.convertToPdfPoint(0, 0);
    const [bx, by] = vp.convertToPdfPoint(vp.width, vp.height);
    return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
  });

const annots = (page: Page, index = 0) => page.evaluate((i) => (window as any).__pfw.app.document.annotationsAt(i), index);
const selected = (page: Page) => page.evaluate(() => (window as any).__pfw.markup.controller.selected?.annotId ?? null);

async function pickShape(page: Page, label: string) {
  await page.click('[data-markup="shapes"]');
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

const FILLED = { id: 'rc', kind: 'rect', color: '#ff3b30', opacity: 1, modified: 'x', rect: { x0: 100, y0: 400, x1: 400, y1: 600 }, fill: '#34c759', width: 2, rounded: false };

test.describe('markup review fixes', () => {
  test('a selection from one page into the next marks the right lines after a jump and a scroll up', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 0.5));
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(10));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('viewer')!.scrollBy({ top: -560 }));
    await page.waitForSelector('#viewer .page[data-page="10"] .textLayer span');
    await page.waitForSelector('#viewer .page[data-page="11"] .textLayer span');
    // Page elements are in page order, whatever order they were mounted in.
    const order = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#viewer .page')].map((e) => Number(e.dataset['page'])));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const s10 = page.locator('#viewer .page[data-page="10"] .textLayer span', { hasText: 'long fixture page 10' });
    const s11 = page.locator('#viewer .page[data-page="11"] .textLayer span', { hasText: 'Page 11 of 300' });
    const a = (await s10.boundingBox())!;
    const b = (await s11.boundingBox())!;
    await page.click('#toolbar [data-action="highlight"]');
    await page.mouse.move(a.x + 1, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x + b.width) / 2, (a.y + b.y + b.height) / 2, { steps: 6 });
    await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await annots(page, 10)).length).toBe(1);
    expect((await annots(page, 9)).map((x: any) => x.text)).toEqual(['long fixture page 10']);
    expect((await annots(page, 10)).map((x: any) => x.text)).toEqual(['Page 11 of 300']);
  });

  test('presses inside an open text box editor stay in the editor', async ({ page }) => {
    await openFit(page);
    await page.evaluate((a) => (window as any).__pfw.app.document.setAnnotations(0, [a]), FILLED);
    const box = (await page.locator('#viewer .markup-overlay [data-annot-id="rc"]').boundingBox())!;
    await page.click('[data-markup="text"]');
    await page.mouse.click(box.x + 20, box.y + 20);
    await page.keyboard.type('hello world');
    const editor = page.locator('#viewer .mk-text-editor');
    const ed = (await editor.boundingBox())!;
    await page.mouse.click(ed.x + ed.width - 4, ed.y + ed.height / 2);
    expect(await selected(page)).toBe(null);
    await expect(editor).toBeFocused();
    await page.keyboard.type('XYZ');
    await expect(editor).toHaveValue('hello worldXYZ');
    await page.mouse.move(ed.x + 8, ed.y + ed.height / 2);
    await page.mouse.down();
    await page.mouse.move(ed.x + 60, ed.y + ed.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    expect((await annots(page)).find((a: any) => a.id === 'rc').rect).toEqual(FILLED.rect);
    await expect(editor).toBeFocused();
  });

  test('text typed into an open editor is in the document before saving or closing', async ({ page }) => {
    await openFit(page);
    await page.click('[data-markup="text"]');
    const c = await at(page, 0.2, 0.5);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type('important words');
    await page.evaluate(() => void (window as any).__pfw.app.confirmDiscard());
    // The unsaved-changes alert asks, and the box is part of the document.
    await expect(page.locator('.alert-scrim')).toBeVisible();
    expect((await annots(page)).map((a: any) => a.text)).toEqual(['important words']);
    await page.keyboard.press('Escape');

    await page.click('[data-markup="text"]');
    const d = await at(page, 0.2, 0.7);
    await page.mouse.click(d.x, d.y);
    await page.keyboard.type('saved too');
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => (window as any).__pfw.store.get().dirty)).toBe(false);
    expect((await annots(page)).map((a: any) => a.text)).toEqual(['important words', 'saved too']);
  });

  test('annotations stay on their page when dragged or drawn past its edge', async ({ page }) => {
    await openFit(page);
    await page.evaluate((a) => (window as any).__pfw.app.document.setAnnotations(0, [{ ...a, rect: { x0: 300, y0: 100, x1: 400, y1: 170 } }]), FILLED);
    const box = (await page.locator('#viewer .markup-overlay [data-annot-id="rc"]').boundingBox())!;
    const pg = (await page.locator('#viewer .page[data-page="1"]').boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 900, pg.y + pg.height + 200, { steps: 8 });
    await page.mouse.up();
    const pb = await pageBox(page);
    const [r] = await annots(page);
    expect(r.rect.y0).toBeCloseTo(pb.y0, 3);
    expect(r.rect.x1).toBeCloseTo(pb.x1, 3);
    expect(r.rect.x1 - r.rect.x0).toBeCloseTo(100, 5);

    await pickShape(page, 'Rectangle');
    const a = await at(page, 0.5, 0.5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(pg.x - 100, pg.y + pg.height + 100, { steps: 8 });
    await page.mouse.up();
    const made = (await annots(page))[1];
    expect(made.rect.x0).toBeGreaterThanOrEqual(pb.x0 - 0.001);
    expect(made.rect.y0).toBeGreaterThanOrEqual(pb.y0 - 0.001);
  });

  test('scrolling during a drag keeps the anchor where the drag started on the page', async ({ page }) => {
    await open(page);
    await page.click('#toolbar [data-action="markup"]');
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 1));
    await settle(page);
    await pickShape(page, 'Rectangle');
    const a = await at(page, 0.3, 0.1);
    const anchor = await toPdf(page, a);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 60, { steps: 4 });
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    await page.mouse.move(a.x + 120, a.y + 120, { steps: 4 });
    const end = await toPdf(page, { x: a.x + 120, y: a.y + 120 });
    await page.mouse.up();
    const [r] = await annots(page);
    expect(Math.abs(r.rect.x0 - anchor.x)).toBeLessThan(1);
    expect(Math.abs(r.rect.y1 - anchor.y)).toBeLessThan(1);
    expect(Math.abs(r.rect.y0 - end.y)).toBeLessThan(1);
  });

  test('a style control right after typing a new text box restyles that box', async ({ page }) => {
    await openFit(page);
    await page.click('[data-markup="text"]');
    const c = await at(page, 0.2, 0.5);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type('make me bigger');
    await page.click('[data-markup="text-style"]');
    await page.click('[data-size-step="1"]');
    await page.keyboard.press('Escape');
    const [box] = await annots(page);
    expect(box).toMatchObject({ text: 'make me bigger', fontSize: 14 });
    expect(await selected(page)).toBe(box.id);
  });

  test('arrow keys move the selection only while the document view has focus', async ({ page }) => {
    await openFit(page);
    await page.evaluate((a) => (window as any).__pfw.app.document.setAnnotations(0, [a]), FILLED);
    const box = (await page.locator('#viewer .markup-overlay [data-annot-id="rc"]').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await selected(page)).toBe('rc');
    await page.locator('#toolbar [data-action="zoom-in"]').focus();
    await page.keyboard.press('ArrowRight');
    expect((await annots(page))[0].rect).toEqual(FILLED.rect);
    await page.locator('#viewer').focus();
    await page.keyboard.press('ArrowRight');
    expect((await annots(page))[0].rect.x0).toBeCloseTo(101, 5);
  });
});
