import { expect, test, type Page } from '@playwright/test';

/** Opens simple.pdf with the markup toolbar shown, at Fit Page, once the layout stopped moving. */
async function open(page: Page) {
  await page.goto('/?file=fixtures/simple.pdf');
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.click('#toolbar [data-action="markup"]');
  await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-page'));
  await settle(page);
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
          return Math.abs(v.viewport.width - r.width) < 1 && r.bottom <= window.innerHeight ? `${r.x},${r.y},${r.width}` : '';
        });
        const stable = now !== '' && now === last;
        last = now;
        return stable;
      },
      { intervals: [150] },
    )
    .toBe(true);
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
}

const base = { opacity: 1, modified: '2026-10-26T00:00:00Z' };
const RECT = { ...base, id: 'r1', kind: 'rect', color: '#ff3b30', rect: { x0: 200, y0: 400, x1: 300, y1: 470 }, fill: null, width: 2, rounded: false };
const LINE = { ...base, id: 'l1', kind: 'line', color: '#000000', from: { x: 100, y: 300 }, to: { x: 250, y: 300 }, width: 2 };
const TEXT = {
  ...base,
  id: 't1',
  kind: 'text',
  color: '#000000',
  rect: { x0: 80, y0: 200, x1: 224, y1: 218.4 },
  text: 'Some words',
  fontSize: 12,
  fill: null,
  border: null,
  borderWidth: 1,
  angle: 0,
};
const NOTE = { ...base, id: 'n1', kind: 'note', color: '#ffd60a', rect: { x0: 400, y0: 600, x1: 420, y1: 620 }, text: 'A note', angle: 0 };

async function seed(page: Page, list: unknown[], index = 0) {
  await page.evaluate(({ list, index }) => (window as any).__pfw.app.document.setAnnotations(index, list), { list, index });
}

const annots = (page: Page, index = 0) => page.evaluate((i) => (window as any).__pfw.app.document.annotationsAt(i), index);
const find = async (page: Page, id: string, index = 0) => (await annots(page, index)).find((a: any) => a.id === id);
const selected = (page: Page) => page.evaluate(() => (window as any).__pfw.markup.controller.selected?.annotId ?? null);

/** Client point of a PDF point on page `index`, and CSS px per point. */
const client = (page: Page, x: number, y: number, index = 0) =>
  page.evaluate(
    ({ x, y, index }) => {
      const view = (window as any).__pfw.viewer.getPageViews().find((v: any) => v.index === index);
      const r = view.el.getBoundingClientRect();
      const [px, py] = view.viewport.convertToViewportPoint(x, y);
      return { x: r.left + px, y: r.top + py, k: view.viewport.scale * (r.width / view.viewport.width) };
    },
    { x, y, index },
  );

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

async function handle(page: Page, name: string) {
  const box = (await page.locator(`#viewer .mk-handles [data-handle="${name}"]`).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('selecting and editing annotations', () => {
  test('a click selects; dragging a selected rectangle moves it by the dragged distance as one undo step', async ({ page }) => {
    await open(page);
    await seed(page, [RECT]);
    // On the top edge between handles (no fill: the stroke is the target).
    const edge = await client(page, 225, 470);
    await page.mouse.click(edge.x, edge.y);
    expect(await selected(page)).toBe('r1');
    await expect(page.locator('#viewer .mk-handles [data-handle]')).toHaveCount(8);
    expect(await page.locator('#viewer .page[data-page="1"]').evaluate((el) => getComputedStyle(el.querySelector('canvas')!).cursor)).toBe('move');

    const canvas = await page.evaluate(() => {
      (window as any).__canvas = document.querySelector('#viewer .page[data-page="1"] canvas');
      return true;
    });
    expect(canvas).toBe(true);
    await drag(page, edge, 50, 30);
    const moved = await find(page, 'r1');
    expect(moved.rect.x0).toBeCloseTo(200 + 50 / edge.k, 1);
    expect(moved.rect.x1).toBeCloseTo(300 + 50 / edge.k, 1);
    expect(moved.rect.y1).toBeCloseTo(470 - 30 / edge.k, 1);
    expect(await selected(page)).toBe('r1');
    expect(await page.evaluate(() => (window as any).__canvas === document.querySelector('#viewer .page[data-page="1"] canvas'))).toBe(true);
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');

    await page.keyboard.press('Control+z');
    expect((await find(page, 'r1')).rect).toEqual(RECT.rect);
  });

  test('resizing from the bottom-right handle; Shift keeps the proportions', async ({ page }) => {
    await open(page);
    await seed(page, [RECT]);
    const edge = await client(page, 200, 435);
    await page.mouse.click(edge.x, edge.y);
    await drag(page, await handle(page, 'se'), 40, 20);
    const r = (await find(page, 'r1')).rect;
    expect(r.x0).toBeCloseTo(200, 1);
    expect(r.y1).toBeCloseTo(470, 1);
    expect(r.x1).toBeCloseTo(300 + 40 / edge.k, 1);
    expect(r.y0).toBeCloseTo(400 - 20 / edge.k, 1);
    await page.keyboard.press('Control+z');
    expect((await find(page, 'r1')).rect).toEqual(RECT.rect);

    await page.keyboard.down('Shift');
    await drag(page, await handle(page, 'se'), 60, 5);
    await page.keyboard.up('Shift');
    const s = (await find(page, 'r1')).rect;
    expect((s.x1 - s.x0) / (s.y1 - s.y0)).toBeCloseTo(100 / 70, 2);
    expect(s.x1 - s.x0).toBeGreaterThan(110);
  });

  test('a line has two endpoint handles; dragging one moves only that end', async ({ page }) => {
    await open(page);
    await seed(page, [LINE]);
    const mid = await client(page, 175, 300);
    await page.mouse.click(mid.x, mid.y);
    expect(await selected(page)).toBe('l1');
    await expect(page.locator('#viewer .mk-handles [data-handle]')).toHaveCount(2);
    await drag(page, await handle(page, 'to'), 0, -40);
    const l = await find(page, 'l1');
    expect(l.from).toEqual(LINE.from);
    expect(l.to.x).toBeCloseTo(250, 1);
    expect(l.to.y).toBeCloseTo(300 + 40 / mid.k, 1);
  });

  test('Delete removes, Ctrl+Z restores, Ctrl+Y removes again; undoing to the opened state clears “Edited”', async ({ page }) => {
    await open(page);
    await page.click('[data-markup="shapes"]');
    await page.getByRole('menuitemradio', { name: 'Rectangle', exact: true }).click();
    const a = await client(page, 150, 500);
    await drag(page, a, 120, 80);
    await expect(page.locator('[data-doc-edited]')).toBeVisible();
    const [made] = await annots(page);
    expect(await selected(page)).toBe(made.id);
    await page.keyboard.press('Delete');
    expect(await annots(page)).toHaveLength(0);
    expect(await selected(page)).toBe(null);
    await page.keyboard.press('Control+z');
    expect(await annots(page)).toHaveLength(1);
    await page.keyboard.press('Control+y');
    expect(await annots(page)).toHaveLength(0);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await annots(page)).toHaveLength(0);
    await expect(page.locator('[data-doc-edited]')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__pfw.store.get().dirty)).toBe(false);
  });

  test('arrow keys nudge by 1 pt (Shift: 10 pt) without changing pages; Esc deselects', async ({ page }) => {
    await open(page);
    await seed(page, [RECT]);
    const edge = await client(page, 200, 435);
    await page.mouse.click(edge.x, edge.y);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ArrowUp');
    const r = (await find(page, 'r1')).rect;
    expect(r.x0).toBeCloseTo(201, 5);
    expect(r.y0).toBeCloseTo(391, 5);
    expect(await page.evaluate(() => (window as any).__pfw.store.get().currentPage)).toBe(1);
    await page.keyboard.press('Control+z');
    expect((await find(page, 'r1')).rect.y0).toBeCloseTo(390, 5);
    await page.keyboard.press('Escape');
    expect(await selected(page)).toBe(null);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => (window as any).__pfw.store.get().currentPage)).toBe(2);
  });

  test('Ctrl+D duplicates 10 pt right and down and selects the copy', async ({ page }) => {
    await open(page);
    await seed(page, [RECT]);
    const edge = await client(page, 200, 435);
    await page.mouse.click(edge.x, edge.y);
    await page.keyboard.press('Control+d');
    const list = await annots(page);
    expect(list).toHaveLength(2);
    const copy = list[1];
    expect(copy.id).not.toBe('r1');
    expect(copy.rect).toEqual({ x0: 210, y0: 390, x1: 310, y1: 460 });
    expect(await selected(page)).toBe(copy.id);
  });

  test('Border Color recolors the selected line and becomes the color of the next line', async ({ page }) => {
    await open(page);
    await seed(page, [LINE]);
    const mid = await client(page, 175, 300);
    await page.mouse.click(mid.x, mid.y);
    await page.click('[data-markup="stroke"]');
    await page.locator('.markup-palette [data-color="#007aff"]').click();
    expect((await find(page, 'l1')).color).toBe('#007aff');
    await page.click('[data-markup="shapes"]');
    await page.getByRole('menuitemradio', { name: 'Line', exact: true }).click();
    await drag(page, await client(page, 100, 200), 100, 0);
    expect((await annots(page))[1]).toMatchObject({ kind: 'line', color: '#007aff' });
    // The recolor was one undo step of its own.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect((await find(page, 'l1')).color).toBe('#000000');
  });

  test('Line Width and Fill restyle the selected shape; Text Style restyles the selected text box', async ({ page }) => {
    await open(page);
    await seed(page, [RECT, TEXT]);
    const edge = await client(page, 200, 435);
    await page.mouse.click(edge.x, edge.y);
    await page.click('[data-markup="width"]');
    await page.getByRole('menuitemradio', { name: '5 pt', exact: true }).click();
    await page.click('[data-markup="fill"]');
    await page.locator('.markup-palette [data-color="#34c759"]').click();
    expect(await find(page, 'r1')).toMatchObject({ width: 5, fill: '#34c759' });

    const t = await client(page, 120, 210);
    await page.mouse.click(t.x, t.y);
    expect(await selected(page)).toBe('t1');
    await page.click('[data-markup="text-style"]');
    await page.locator('.markup-palette [data-size-step="1"]').click();
    await page.locator('.markup-palette [data-color="#af52de"]').click();
    await page.keyboard.press('Escape');
    const box = await find(page, 't1');
    expect(box).toMatchObject({ fontSize: 14, color: '#af52de' });
    // The box grew to fit the bigger line.
    expect(box.rect.y1 - box.rect.y0).toBeGreaterThanOrEqual(14 * 1.2 + 4 - 0.5);
    expect(box.rect.y1).toBeCloseTo(TEXT.rect.y1, 5);
  });

  test('right-click an annotation for Duplicate, Delete and, on text boxes, Edit Text', async ({ page }) => {
    await open(page);
    await seed(page, [RECT, TEXT]);
    const edge = await client(page, 200, 435);
    await page.mouse.click(edge.x, edge.y, { button: 'right' });
    expect(await page.$$eval('.menu .menu-label', (els) => els.map((e) => e.textContent))).toEqual(['Duplicate', 'Delete']);
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    expect(await annots(page)).toHaveLength(3);

    const t = await client(page, 120, 210);
    await page.mouse.click(t.x, t.y, { button: 'right' });
    expect(await selected(page)).toBe('t1');
    expect(await page.$$eval('.menu .menu-label', (els) => els.map((e) => e.textContent))).toEqual(['Edit Text', 'Duplicate', 'Delete']);
    await page.getByRole('menuitem', { name: 'Edit Text' }).click();
    const editor = page.locator('#viewer .mk-text-editor');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Some words');
    await page.keyboard.press('End');
    await page.keyboard.type(' and more');
    await page.keyboard.press('Escape');
    expect((await find(page, 't1')).text).toBe('Some words and more');
    await page.keyboard.press('Control+z');
    expect((await find(page, 't1')).text).toBe('Some words');

    await page.mouse.click(edge.x, edge.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    expect((await annots(page)).map((a: any) => a.id)).not.toContain('r1');
  });

  test('double-clicking a text box edits it again as one undo step; emptying it removes it', async ({ page }) => {
    await open(page);
    await seed(page, [TEXT]);
    const t = await client(page, 120, 210);
    await page.mouse.dblclick(t.x, t.y);
    const editor = page.locator('#viewer .mk-text-editor');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Replaced');
    await page.mouse.click(t.x + 300, t.y + 200);
    expect((await find(page, 't1')).text).toBe('Replaced');
    await page.keyboard.press('Control+z');
    expect((await find(page, 't1')).text).toBe('Some words');

    await page.mouse.dblclick(t.x, t.y);
    await expect(editor).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    expect(await annots(page)).toHaveLength(0);
    await page.keyboard.press('Control+z');
    expect((await find(page, 't1')).text).toBe('Some words');
  });

  test('a click on a note opens its popup; a drag moves it', async ({ page }) => {
    await open(page);
    await seed(page, [NOTE]);
    const c = await client(page, 410, 610);
    await page.mouse.click(c.x, c.y);
    const popup = page.locator('.mk-note-popup textarea');
    await expect(popup).toBeFocused();
    await expect(popup).toHaveValue('A note');
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    expect(await selected(page)).toBe('n1');
    await drag(page, c, 30, 0);
    await expect(popup).toHaveCount(0);
    expect((await find(page, 'n1')).rect.x0).toBeCloseTo(400 + 30 / c.k, 1);
  });

  test('a click on highlighted text selects the highlight; a drag from it still selects text', async ({ page }) => {
    await open(page);
    await page.waitForSelector('#viewer .page[data-page="1"] .textLayer span');
    const span = page.locator('#viewer .page[data-page="1"] .textLayer > span').nth(1);
    const box = (await span.boundingBox())!;
    await page.click('#toolbar [data-action="highlight"]');
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await annots(page)).length).toBe(1);
    await page.click('#toolbar [data-action="highlight"]');
    const [hl] = await annots(page);

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await selected(page)).toBe(hl.id);
    await expect(page.locator('#viewer .mk-handles .mk-outline')).toHaveCount(1);
    await expect(page.locator('#viewer .mk-handles [data-handle]')).toHaveCount(0);

    // A style picked while it is selected restyles it, from the toolbar or its context menu.
    await page.click('#toolbar [data-action="highlight-menu"]');
    await page.getByRole('menuitemradio', { name: 'Green' }).click();
    expect((await annots(page))[0]).toMatchObject({ kind: 'highlight', color: '#8ee07a' });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    expect(await page.$$eval('.menu .menu-label', (els) => els.map((e) => e.textContent))).toEqual([
      'Yellow', 'Green', 'Blue', 'Pink', 'Purple', 'Underline', 'Strikethrough', 'Delete',
    ]);
    await page.getByRole('menuitemradio', { name: 'Underline' }).click();
    expect((await annots(page))[0]).toMatchObject({ kind: 'underline', color: '#ff3b30' });
    expect(await page.evaluate(() => (window as any).__pfw.app.document.annotationsAt(0).length)).toBe(1);
    expect(await selected(page)).toBe(hl.id);

    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    expect((await page.evaluate(() => getSelection()?.toString() ?? '')).length).toBeGreaterThan(5);
    expect(await selected(page)).toBe(null);
    expect(await annots(page)).toHaveLength(1);
  });

  test('the selection survives moving its page in the sidebar; Delete in the sidebar still deletes pages', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
    await settle(page);
    await page.waitForSelector('#sidebar .thumb[data-page="2"]');
    await seed(page, [RECT]);
    const edge = await client(page, 200, 435);
    await page.mouse.click(edge.x, edge.y);
    const ref = await page.evaluate(() => (window as any).__pfw.markup.controller.selected);

    // Drag thumbnail 1 below thumbnail 2.
    const t1 = (await page.locator('#sidebar .thumb[data-page="1"]').boundingBox())!;
    const t2 = (await page.locator('#sidebar .thumb[data-page="2"]').boundingBox())!;
    await page.mouse.move(t1.x + t1.width / 2, t1.y + t1.height / 2);
    await page.mouse.down();
    await page.mouse.move(t1.x + t1.width / 2, t1.y + t1.height / 2 + 8, { steps: 2 });
    await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height - 4, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await annots(page, 1)).length).toBe(1);
    expect(await page.evaluate(() => (window as any).__pfw.markup.controller.selected)).toEqual(ref);
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(1));
    await expect(page.locator('#viewer .page[data-page="2"] .mk-handles [data-handle]')).toHaveCount(8);

    // Focus is in the thumbnail list: Delete deletes the selected page, not the annotation.
    await page.locator('#sidebar .thumb[data-page="1"]').click();
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => (window as any).__pfw.app.document.numPages)).toBe(2);
    expect(await annots(page, 0)).toHaveLength(1);
  });
});
