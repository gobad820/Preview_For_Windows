import { expect, test, type Locator, type Page } from '@playwright/test';

async function open(page: Page, name = 'simple.pdf') {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.waitForSelector('#viewer .page[data-page="1"] .textLayer span');
}

const spans = (page: Page, n: number) => page.locator(`#viewer .page[data-page="${n}"] .textLayer > span, #viewer .page[data-page="${n}"] .textLayer .markedContent > span`);

/** Drags from just inside the start of `from` to just inside the end of `to` with the real mouse. */
async function selectText(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 1, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x + b.width) / 2, (a.y + b.y + b.height) / 2, { steps: 6 });
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

const annots = (page: Page, index = 0) => page.evaluate((i) => (window as any).__pfw.app.document.annotationsAt(i), index);
const selectionText = (page: Page) => page.evaluate(() => getSelection()?.toString() ?? '');

/** Screen box of a quad on page `index`. */
const quadBox = (page: Page, index: number, quad: number[]) =>
  page.evaluate(
    ({ index, quad }) => {
      const view = (window as any).__pfw.viewer.getPageViews().find((v: any) => v.index === index);
      const r = view.el.getBoundingClientRect();
      const pts = [0, 2, 4, 6].map((i) => view.viewport.convertToViewportPoint(quad[i], quad[i + 1]));
      const xs = pts.map((p: number[]) => r.left + p[0]!);
      const ys = pts.map((p: number[]) => r.top + p[1]!);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    },
    { index, quad },
  );

/** Fraction of the smaller extent that two boxes share along the cross-line axis. */
function overlap(a: { x: number; y: number; width: number; height: number }, b: typeof a, axis: 'x' | 'y') {
  const [a0, a1, b0, b1] = axis === 'y' ? [a.y, a.y + a.height, b.y, b.y + b.height] : [a.x, a.x + a.width, b.x, b.x + b.width];
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.min(a1 - a0, b1 - b0);
}

test.describe('highlight, underline and strikethrough from the text selection', () => {
  test('in highlight mode, finishing a selection marks it with one quad per line and clears it', async ({ page }) => {
    await open(page);
    await page.click('#toolbar [data-action="highlight"]');
    const s = spans(page, 1);
    await selectText(page, s.nth(1), s.nth(2));
    await expect.poll(async () => (await annots(page)).length).toBe(1);
    const [hl] = await annots(page);
    expect(hl).toMatchObject({ kind: 'highlight', color: '#ffe14d', opacity: 1 });
    expect(hl.quads).toHaveLength(2);
    expect(hl.text).toContain('This is page 1');
    expect(hl.text).toContain('quick brown fox');
    expect(await selectionText(page)).toBe('');
    for (const [i, n] of [
      [0, 1],
      [1, 2],
    ] as const) {
      const q = await quadBox(page, 0, hl.quads[i]);
      const span = (await s.nth(n).boundingBox())!;
      expect(overlap(q, span, 'y')).toBeGreaterThan(0.8);
      expect(overlap(q, span, 'x')).toBeGreaterThan(0.9);
    }
    // Drawn with multiply, and shown in the overlay.
    await expect(page.locator('#viewer .page[data-page="1"] .markup-overlay .mk-marks [data-kind="highlight"]')).toHaveCount(1);
  });

  test('a selection from one page into the next marks the selected lines on each page as one undo step', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 0.5));
    await page.waitForSelector('#viewer .page[data-page="2"] .textLayer span');
    await expect.poll(async () => (await spans(page, 2).first().boundingBox())?.y ?? 9999).toBeLessThan(760);
    await page.click('#toolbar [data-action="highlight"]');
    const p1 = spans(page, 1);
    const p2 = spans(page, 2);
    await selectText(page, p1.nth(3), p2.nth(0));
    await expect.poll(async () => (await annots(page, 1)).length).toBe(1);
    const [a] = await annots(page, 0);
    const [b] = await annots(page, 1);
    expect(await annots(page, 0)).toHaveLength(1);
    expect(a.quads).toHaveLength(1);
    expect(b.quads).toHaveLength(1);
    expect(a.text).toContain('Preview for Windows');
    expect(b.text).toContain('Hello world page 2');
    expect(overlap(await quadBox(page, 0, a.quads[0]), (await p1.nth(3).boundingBox())!, 'y')).toBeGreaterThan(0.8);
    expect(overlap(await quadBox(page, 1, b.quads[0]), (await p2.nth(0).boundingBox())!, 'y')).toBeGreaterThan(0.8);

    await page.locator('#viewer').focus();
    await page.keyboard.press('Control+z');
    expect(await annots(page, 0)).toHaveLength(0);
    expect(await annots(page, 1)).toHaveLength(0);
    await page.keyboard.press('Control+y');
    expect(await annots(page, 0)).toHaveLength(1);
    expect(await annots(page, 1)).toHaveLength(1);
  });

  test('with highlight mode off, the highlight button marks the selection and turns the mode on', async ({ page }) => {
    await open(page);
    const s = spans(page, 1);
    await selectText(page, s.nth(1), s.nth(1));
    expect(await annots(page)).toHaveLength(0);
    expect((await selectionText(page)).length).toBeGreaterThan(10);
    await page.click('#toolbar [data-action="highlight"]');
    await expect.poll(async () => (await annots(page)).length).toBe(1);
    expect((await annots(page))[0].kind).toBe('highlight');
    await expect(page.locator('#toolbar [data-action="highlight"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await selectionText(page)).toBe('');
  });

  test('Strikethrough and Underline from the chevron menu mark the next selection in red', async ({ page }) => {
    await open(page);
    await page.click('#toolbar [data-action="highlight-menu"]');
    await page.getByRole('menuitemradio', { name: 'Strikethrough' }).click();
    const s = spans(page, 1);
    await selectText(page, s.nth(2), s.nth(2));
    await expect.poll(async () => (await annots(page)).length).toBe(1);
    expect((await annots(page))[0]).toMatchObject({ kind: 'strikeout', color: '#ff3b30' });
    await page.click('#toolbar [data-action="highlight-menu"]');
    await page.getByRole('menuitemradio', { name: 'Underline' }).click();
    await selectText(page, s.nth(3), s.nth(3));
    await expect.poll(async () => (await annots(page)).length).toBe(2);
    expect((await annots(page))[1]).toMatchObject({ kind: 'underline', color: '#ff3b30' });
    await expect(page.locator('#viewer .page[data-page="1"] .markup-overlay [data-kind="underline"]')).toHaveCount(1);
  });

  test('with highlight mode off, selecting and Ctrl+C copy text as before and mark nothing', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      (window as any).__copied = [];
      document.addEventListener('copy', (e) => {
        // Runs after the app's handlers: a prevented copy would not reach the clipboard.
        setTimeout(() => (window as any).__copied.push({ text: getSelection()?.toString(), prevented: e.defaultPrevented }));
      });
    });
    const s = spans(page, 1);
    await selectText(page, s.nth(1), s.nth(2));
    await page.keyboard.press('Control+c');
    await expect.poll(() => page.evaluate(() => (window as any).__copied.length)).toBe(1);
    const [copied] = await page.evaluate(() => (window as any).__copied);
    expect(copied.prevented).toBe(false);
    expect(copied.text).toContain('This is page 1');
    expect(copied.text).toContain('quick brown fox');
    expect(await annots(page)).toHaveLength(0);
  });

  test('in a rotated view, text selection follows the page and the highlight lands on the text', async ({ page }) => {
    await open(page);
    await page.locator('#viewer').focus();
    await page.keyboard.press('Control+l');
    await expect.poll(async () => page.evaluate(() => (window as any).__pfw.viewer.getPageViews()[0]?.viewport.rotation)).toBe(90);
    await page.waitForFunction(() => document.querySelector('#viewer .page[data-page="1"] .textLayer')?.getAttribute('data-main-rotation') === '90');
    await page.waitForSelector('#viewer .page[data-page="1"] .textLayer span');
    const s = spans(page, 1);
    const box = (await s.nth(1).boundingBox())!;
    // The line runs down the screen: taller than wide.
    expect(box.height).toBeGreaterThan(box.width * 3);
    // The span covers the glyphs the canvas drew there.
    const ink = await page.evaluate(({ x, y, w, h }) => {
      const page1 = document.querySelector('#viewer .page[data-page="1"]')!;
      const canvas = page1.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const k = canvas.width / r.width;
      const data = canvas.getContext('2d')!.getImageData((x - r.left) * k, (y - r.top) * k, Math.max(1, w * k), Math.max(1, h * k)).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) dark++;
      return dark;
    }, { x: box.x, y: box.y, w: box.width, h: box.height });
    expect(ink).toBeGreaterThan(50);

    await page.click('#toolbar [data-action="highlight"]');
    const a = { x: box.x + box.width / 2, y: box.y + 1 };
    const b = { x: box.x + box.width / 2, y: box.y + box.height - 1 };
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await annots(page)).length).toBe(1);
    const [hl] = await annots(page);
    expect(hl.quads).toHaveLength(1);
    const q = await quadBox(page, 0, hl.quads[0]);
    expect(overlap(q, box, 'x')).toBeGreaterThan(0.8);
    expect(overlap(q, box, 'y')).toBeGreaterThan(0.9);
    // In page space the line is horizontal: the quad's top edge runs along +x.
    expect(hl.quads[0][2]).toBeGreaterThan(hl.quads[0][0]);
    expect(Math.abs(hl.quads[0][3] - hl.quads[0][1])).toBeLessThan(0.01);
  });
});
