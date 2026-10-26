import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name = 'simple.pdf') {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
}

const base = { opacity: 1, modified: '2026-10-26T00:00:00Z' };

/** One annotation of every kind on page 1, with the PDF box each one's element must cover. */
const SEED = [
  { a: { ...base, id: 'hl', kind: 'highlight', color: '#ffe14d', quads: [[72, 700, 200, 700, 72, 686, 200, 686]], text: 'x' }, box: [72, 686, 200, 700] },
  { a: { ...base, id: 'ul', kind: 'underline', color: '#ff3b30', quads: [[72, 660, 180, 660, 72, 646, 180, 646]], text: 'y' }, box: [72, 646, 180, 660] },
  { a: { ...base, id: 'so', kind: 'strikeout', color: '#ff3b30', quads: [[72, 620, 160, 620, 72, 606, 160, 606]], text: 'z' }, box: [72, 606, 160, 620] },
  { a: { ...base, id: 'rc', kind: 'rect', color: '#ff3b30', rect: { x0: 300, y0: 600, x1: 400, y1: 670 }, fill: null, width: 2, rounded: false }, box: [300, 600, 400, 670] },
  { a: { ...base, id: 'rr', kind: 'rect', color: '#007aff', rect: { x0: 420, y0: 600, x1: 520, y1: 670 }, fill: '#34c759', width: 3, rounded: true }, box: [420, 600, 520, 670] },
  { a: { ...base, id: 'ov', kind: 'oval', color: '#ff3b30', rect: { x0: 300, y0: 500, x1: 400, y1: 570 }, fill: null, width: 2, rounded: false }, box: [300, 500, 400, 570] },
  { a: { ...base, id: 'ln', kind: 'line', color: '#000000', from: { x: 72, y: 500 }, to: { x: 172, y: 560 }, width: 2 }, box: [72, 500, 172, 560] },
  // Arrowhead wings: 6 pt long at ±30° → x 172 − 5.196, y 450 ± 3.
  { a: { ...base, id: 'ar', kind: 'arrow', color: '#000000', from: { x: 72, y: 450 }, to: { x: 172, y: 450 }, width: 2 }, box: [72, 447, 172, 453] },
  {
    a: { ...base, id: 'ik', kind: 'ink', color: '#af52de', paths: [[{ x: 300, y: 400 }, { x: 330, y: 440 }, { x: 360, y: 410 }, { x: 400, y: 450 }]], width: 2 },
    box: [300, 400, 400, 450],
  },
  {
    a: { ...base, id: 'tx', kind: 'text', color: '#000000', rect: { x0: 72, y0: 300, x1: 272, y1: 340 }, text: 'Hello 안녕', fontSize: 12, fill: null, border: null, borderWidth: 1, angle: 0 },
    box: [72, 300, 272, 340],
  },
  { a: { ...base, id: 'nt', kind: 'note', color: '#ffd60a', rect: { x0: 450, y0: 300, x1: 470, y1: 320 }, text: 'note', angle: 0 }, box: [450, 300, 470, 320] },
];

async function seed(page: Page) {
  await page.evaluate((list) => (window as any).__pfw.app.document.setAnnotations(0, list), SEED.map((s) => s.a));
}

/** For each seeded annotation in the given view: max distance (CSS px) between its element's rect and the expected one. */
async function offsets(page: Page, where: 'viewer' | 'thumbs') {
  return page.evaluate(
    ({ where, boxes }) => {
      const pfw = (window as any).__pfw;
      const views = where === 'viewer' ? pfw.viewer.getPageViews() : pfw.sidebar.thumbnails.getPageViews();
      const view = views.find((v: any) => v.index === 0);
      if (!view) return null;
      const host = view.el.getBoundingClientRect();
      const out: Record<string, number> = {};
      const els = view.el.querySelectorAll('.markup-overlay [data-annot-id]');
      for (const [id, [x0, y0, x1, y1]] of Object.entries(boxes as Record<string, [number, number, number, number]>)) {
        const el = view.el.querySelector(`.markup-overlay [data-annot-id="${id}"]`);
        if (!el) {
          out[id] = Infinity;
          continue;
        }
        const pts = [
          [x0, y0],
          [x1, y0],
          [x0, y1],
          [x1, y1],
        ].map(([x, y]) => view.viewport.convertToViewportPoint(x, y));
        const left = host.left + Math.min(...pts.map((p: [number, number]) => p[0]));
        const right = host.left + Math.max(...pts.map((p: [number, number]) => p[0]));
        const top = host.top + Math.min(...pts.map((p: [number, number]) => p[1]));
        const bottom = host.top + Math.max(...pts.map((p: [number, number]) => p[1]));
        const r = el.getBoundingClientRect();
        out[id] = Math.max(Math.abs(r.left - left), Math.abs(r.right - right), Math.abs(r.top - top), Math.abs(r.bottom - bottom));
      }
      out['count'] = els.length;
      return out;
    },
    { where, boxes: Object.fromEntries(SEED.map((s) => [s.a.id, s.box])) },
  );
}

function expectAligned(o: Record<string, number> | null) {
  expect(o).not.toBeNull();
  expect(o!['count']).toBe(SEED.length);
  for (const s of SEED) expect(o![s.a.id], s.a.id).toBeLessThan(1);
}

test.describe('annotation overlays', () => {
  test('draw every kind where its geometry is, on the page and in its thumbnail', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
    await page.waitForSelector('#sidebar .thumb[data-page="1"] canvas[data-rendered="true"]');
    await seed(page);
    await expect.poll(async () => (await offsets(page, 'viewer'))?.['count']).toBe(SEED.length);
    expectAligned(await offsets(page, 'viewer'));
    await expect.poll(async () => (await offsets(page, 'thumbs'))?.['count']).toBe(SEED.length);
    expectAligned(await offsets(page, 'thumbs'));

    const look = await page.evaluate(() => {
      const ov = document.querySelector('#viewer .page[data-page="1"] .markup-overlay')!;
      const hl = ov.querySelector('[data-annot-id="hl"]')!;
      const text = ov.querySelector('[data-annot-id="tx"]') as HTMLElement;
      const cs = getComputedStyle(text);
      return {
        marksBlend: getComputedStyle(hl.closest('svg')!).mixBlendMode,
        text: text.textContent,
        font: cs.fontFamily,
        lineHeight: cs.lineHeight,
        fontSize: cs.fontSize,
        padding: cs.paddingLeft,
        pointerEvents: getComputedStyle(ov).pointerEvents,
        thumbText: document.querySelector('#sidebar .thumb[data-page="1"] .markup-overlay [data-annot-id="tx"]')?.textContent,
      };
    });
    expect(look.marksBlend).toBe('multiply');
    expect(look.text).toBe('Hello 안녕');
    expect(look.font).toBe('"Malgun Gothic", "Apple SD Gothic Neo", sans-serif');
    // Laid out in points (1 pt = 1 px) and scaled as a whole, so line breaks never depend on zoom.
    expect(look.fontSize).toBe('12px');
    expect(look.lineHeight).toBe('14.4px');
    expect(look.padding).toBe('2px');
    expect(look.pointerEvents).toBe('none');
    expect(look.thumbText).toBe('Hello 안녕');
  });

  test('follow zoom and rotation; a style-only change does not re-render the canvas', async ({ page }) => {
    await open(page);
    await seed(page);
    await expect.poll(async () => (await offsets(page, 'viewer'))?.['count']).toBe(SEED.length);

    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 1.5));
    await expect.poll(async () => page.evaluate(() => (window as any).__pfw.viewer.getPageViews()[0]?.viewport.scale)).toBeCloseTo(2, 5);
    await expect.poll(async () => (await offsets(page, 'viewer'))?.['rc']).toBeLessThan(1);
    expectAligned(await offsets(page, 'viewer'));

    await page.locator('#viewer').focus();
    await page.keyboard.press('Control+l');
    await expect.poll(async () => page.evaluate(() => (window as any).__pfw.viewer.getPageViews()[0]?.viewport.rotation)).toBe(90);
    await expect.poll(async () => (await offsets(page, 'viewer'))?.['rc']).toBeLessThan(1);
    expectAligned(await offsets(page, 'viewer'));

    const result = await page.evaluate(async () => {
      const pfw = (window as any).__pfw;
      const doc = pfw.app.document;
      const canvas = document.querySelector('#viewer .page[data-page="1"] canvas');
      const list = doc.annotationsAt(0).map((a: any) => (a.id === 'rc' ? { ...a, color: '#007aff' } : a));
      doc.setAnnotations(0, list);
      await new Promise((r) => setTimeout(r, 300));
      const g = document.querySelector('#viewer .page[data-page="1"] .markup-overlay [data-annot-id="rc"]')!;
      return {
        sameCanvas: canvas === document.querySelector('#viewer .page[data-page="1"] canvas'),
        stroke: g.querySelector('[stroke]')?.getAttribute('stroke'),
      };
    });
    expect(result).toEqual({ sameCanvas: true, stroke: '#007aff' });
  });

  test('draw nothing while the page has no known annotations or its canvas still shows them', async ({ page }) => {
    await open(page);
    await seed(page);
    await expect.poll(async () => (await offsets(page, 'viewer'))?.['count']).toBe(SEED.length);
    const counts = await page.evaluate(() => {
      const pfw = (window as any).__pfw;
      const doc = pfw.app.document;
      const count = () => document.querySelectorAll('#viewer .page[data-page="1"] .markup-overlay [data-annot-id]').length;
      // The canvas was rendered with generation 0; a newer generation means pdf.js still draws them.
      doc.hideGeneration = () => 1;
      pfw.markup.overlays.refresh();
      const stale = count();
      doc.hideGeneration = () => 0;
      const orig = doc.annotationsAt.bind(doc);
      doc.annotationsAt = (i: number) => (i === 0 ? null : orig(i));
      pfw.markup.overlays.refresh();
      const unknown = count();
      doc.annotationsAt = orig;
      pfw.markup.overlays.refresh();
      return { stale, unknown, back: count() };
    });
    expect(counts).toEqual({ stale: 0, unknown: 0, back: SEED.length });
  });
});

// ---- creation tools (real mouse input) --------------------------------------------

/**
 * Opens with the markup toolbar shown and at Fit Page, so all of page 1 is on screen for the
 * mouse and the layout no longer moves (showing the toolbar re-fits the page).
 */
async function openFit(page: Page) {
  await open(page);
  await page.click('#toolbar [data-action="markup"]');
  await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-page'));
  await settle(page);
}

/** Waits until page 1 is on screen, its view matches its element, and it stopped moving. */
async function settle(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => {
        const v = (window as any).__pfw.viewer.getPageViews().find((x: any) => x.index === 0);
        const r = document.querySelector('#viewer .page[data-page="1"]')!.getBoundingClientRect();
        const ok = !!v && r.bottom <= window.innerHeight && Math.abs(v.viewport.width - r.width) < 1;
        return ok ? `${r.x},${r.y},${r.width},${r.height}` : '';
      });
      const stable = now !== '' && now === last;
      last = now;
      return stable;
    }, { intervals: [150] })
    .toBe(true);
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
}

/** Client point at fractions of page 1's box. */
async function at(page: Page, fx: number, fy: number) {
  const box = (await page.locator('#viewer .page[data-page="1"]').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, shift = false) {
  await page.mouse.move(from.x, from.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

/** The PDF point of page 1 under a client point. */
const toPdf = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const view = (window as any).__pfw.viewer.getPageViews().find((v: any) => v.index === 0);
    const r = view.el.getBoundingClientRect();
    const [px, py] = view.viewport.convertToPdfPoint(x - r.left, y - r.top);
    return { x: px, y: py };
  }, p);

const annots = (page: Page, index = 0) => page.evaluate((i) => (window as any).__pfw.app.document.annotationsAt(i), index);
const tool = (page: Page) => page.evaluate(() => (window as any).__pfw.markup.state.tool);
const selected = (page: Page) => page.evaluate(() => (window as any).__pfw.markup.controller.selected);

async function pickShape(page: Page, label: string) {
  if (!(await page.locator('#markupbar').isVisible())) await page.click('#toolbar [data-action="markup"]');
  await page.click('[data-markup="shapes"]');
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

test.describe('creation tools', () => {
  test('Rectangle: a drag creates one rect at the dragged size, then Text Selection is back with it selected', async ({ page }) => {
    await openFit(page);
    await pickShape(page, 'Rectangle');
    expect(await tool(page)).toBe('rect');
    const a = await at(page, 0.3, 0.3);
    const b = await at(page, 0.55, 0.42);
    await drag(page, a, b);
    const list = await annots(page);
    expect(list).toHaveLength(1);
    const r = list[0];
    expect(r).toMatchObject({ kind: 'rect', rounded: false, fill: null, width: 2, color: '#ff3b30', opacity: 1 });
    const p = await toPdf(page, a);
    const q = await toPdf(page, b);
    expect(Math.abs(r.rect.x0 - Math.min(p.x, q.x))).toBeLessThan(1);
    expect(Math.abs(r.rect.x1 - Math.max(p.x, q.x))).toBeLessThan(1);
    expect(Math.abs(r.rect.y0 - Math.min(p.y, q.y))).toBeLessThan(1);
    expect(Math.abs(r.rect.y1 - Math.max(p.y, q.y))).toBeLessThan(1);
    expect(await tool(page)).toBe('select');
    expect(await selected(page)).toEqual({ pageId: expect.any(Number), annotId: r.id });
    expect(await page.locator('[data-markup="select"]').getAttribute('aria-pressed')).toBe('true');
    // One undo step removes it.
    await page.keyboard.press('Control+z');
    expect(await annots(page)).toHaveLength(0);
  });

  test('Oval with Shift is a circle; Rounded Rectangle is rounded and uses the fill default', async ({ page }) => {
    await openFit(page);
    await page.evaluate(() => (window as any).__pfw.markup.state.setStyles({ fill: '#34c759', width: 3, stroke: '#007aff' }));
    await pickShape(page, 'Oval');
    await drag(page, await at(page, 0.3, 0.3), await at(page, 0.6, 0.38), true);
    await pickShape(page, 'Rounded Rectangle');
    await drag(page, await at(page, 0.3, 0.5), await at(page, 0.5, 0.6));
    const [oval, rounded] = await annots(page);
    expect(oval.kind).toBe('oval');
    expect(Math.abs(oval.rect.x1 - oval.rect.x0 - (oval.rect.y1 - oval.rect.y0))).toBeLessThan(0.01);
    expect(oval.rect.x1 - oval.rect.x0).toBeGreaterThan(50);
    expect(rounded).toMatchObject({ kind: 'rect', rounded: true, fill: '#34c759', width: 3, color: '#007aff' });
  });

  test('a click with Arrow creates a 100 pt arrow centered on the click; Shift snaps lines to 45°', async ({ page }) => {
    await openFit(page);
    await pickShape(page, 'Arrow');
    const c = await at(page, 0.5, 0.5);
    await page.mouse.click(c.x, c.y);
    const [arrow] = await annots(page);
    expect(arrow.kind).toBe('arrow');
    expect(Math.hypot(arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y)).toBeCloseTo(100, 3);
    const mid = await toPdf(page, c);
    expect(Math.abs((arrow.from.x + arrow.to.x) / 2 - mid.x)).toBeLessThan(1);
    expect(Math.abs((arrow.from.y + arrow.to.y) / 2 - mid.y)).toBeLessThan(1);
    expect(arrow.to.x).toBeGreaterThan(arrow.from.x);

    await pickShape(page, 'Line');
    await drag(page, await at(page, 0.2, 0.7), await at(page, 0.4, 0.72), true);
    const line = (await annots(page))[1];
    expect(line.kind).toBe('line');
    expect(Math.abs(line.to.y - line.from.y)).toBeLessThan(0.01);
  });

  test('Draw stays armed: three strokes make three ink annotations, points at least 1 pt apart; Esc disarms', async ({ page }) => {
    await openFit(page);
    await page.click('[data-markup="draw"]');
    for (const y of [0.3, 0.4, 0.5]) {
      const a = await at(page, 0.2, y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) await page.mouse.move(a.x + i * 12, a.y + Math.sin(i / 2) * 20);
      await page.mouse.up();
      expect(await tool(page)).toBe('draw');
    }
    const list = await annots(page);
    expect(list.map((a: any) => a.kind)).toEqual(['ink', 'ink', 'ink']);
    for (const ink of list) {
      expect(ink.paths).toHaveLength(1);
      const pts = ink.paths[0];
      expect(pts.length).toBeGreaterThan(5);
      for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)).toBeGreaterThanOrEqual(1);
    }
    expect(await page.evaluate(() => (window as any).__pfw.app.document.canUndo)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await tool(page)).toBe('select');
  });

  test('Text: typing replaces the placeholder, a click outside stores it; an empty box leaves no trace', async ({ page }) => {
    await openFit(page);
    await page.click('[data-markup="text"]');
    const c = await at(page, 0.25, 0.6);
    await page.mouse.click(c.x, c.y);
    const editor = page.locator('#viewer .mk-text-editor');
    await expect(editor).toBeFocused();
    expect(await editor.evaluate((t: HTMLTextAreaElement) => t.value.slice(t.selectionStart, t.selectionEnd))).toBe('Text');
    await page.keyboard.type('안녕 Hello');
    const out = await at(page, 0.8, 0.9);
    await page.mouse.click(out.x, out.y);
    await expect(editor).toHaveCount(0);
    const [box] = await annots(page);
    expect(box).toMatchObject({ kind: 'text', text: '안녕 Hello', fontSize: 12, color: '#000000', fill: null, border: null, angle: 0 });
    const tl = await toPdf(page, c);
    expect(Math.abs(box.rect.x0 - tl.x)).toBeLessThan(1);
    expect(Math.abs(box.rect.y1 - tl.y)).toBeLessThan(1);
    await expect(page.locator('#viewer .markup-overlay .mk-text')).toHaveText('안녕 Hello');

    // An emptied box is not created and leaves no history entry.
    const undoable = await page.evaluate(() => (window as any).__pfw.app.document.version);
    await page.click('[data-markup="text"]');
    const d = await at(page, 0.25, 0.75);
    await page.mouse.click(d.x, d.y);
    await expect(editor).toBeFocused();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    expect(await annots(page)).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).__pfw.app.document.version)).toBe(undoable);
  });

  test('Text: the box grows downward as lines are added', async ({ page }) => {
    await openFit(page);
    await page.click('[data-markup="text"]');
    const c = await at(page, 0.25, 0.3);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type('one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('three');
    await page.keyboard.press('Escape');
    const [box] = await annots(page);
    expect(box.text).toBe('one\ntwo\nthree');
    // Three lines of 12 pt × 1.2 plus 2 pt padding top and bottom; the top edge stays put.
    expect(box.rect.y1 - box.rect.y0).toBeGreaterThanOrEqual(3 * 14.4 + 4 - 0.5);
    const tl = await toPdf(page, c);
    expect(Math.abs(box.rect.y1 - tl.y)).toBeLessThan(1);
    // Esc keeps the box selected.
    expect((await selected(page))?.annotId).toBe(box.id);
  });

  test('Note: a click places a note and opens its popup; an empty note is removed', async ({ page }) => {
    await openFit(page);
    await page.click('[data-markup="note"]');
    const c = await at(page, 0.7, 0.3);
    await page.mouse.click(c.x, c.y);
    const popup = page.locator('.mk-note-popup textarea');
    await expect(popup).toBeFocused();
    // The icon shows next to its open popup.
    await expect(page.locator('#viewer .markup-overlay .mk-note')).toHaveCount(1);
    await page.keyboard.type('Remember this');
    const out = await at(page, 0.2, 0.9);
    await page.mouse.click(out.x, out.y);
    await expect(popup).toHaveCount(0);
    const [note] = await annots(page);
    expect(note).toMatchObject({ kind: 'note', text: 'Remember this', angle: 0 });
    expect(note.rect.x1 - note.rect.x0).toBe(20);
    expect(note.rect.y1 - note.rect.y0).toBe(20);
    const mid = await toPdf(page, c);
    expect(Math.abs((note.rect.x0 + note.rect.x1) / 2 - mid.x)).toBeLessThan(1);
    expect(Math.abs((note.rect.y0 + note.rect.y1) / 2 - mid.y)).toBeLessThan(1);
    await expect(page.locator('#viewer .markup-overlay .mk-note')).toHaveCount(1);

    const version = await page.evaluate(() => (window as any).__pfw.app.document.version);
    await page.click('[data-markup="note"]');
    const d = await at(page, 0.7, 0.5);
    await page.mouse.click(d.x, d.y);
    await expect(popup).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    expect(await annots(page)).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).__pfw.app.document.version)).toBe(version);
  });

  test('in a rotated view a rectangle lands where it was dragged and a new text box reads upright', async ({ page }) => {
    await openFit(page);
    await page.locator('#viewer').focus();
    await page.keyboard.press('Control+l');
    await expect.poll(async () => page.evaluate(() => (window as any).__pfw.viewer.getPageViews()[0]?.viewport.rotation)).toBe(90);
    await settle(page);
    await pickShape(page, 'Rectangle');
    const a = await at(page, 0.3, 0.3);
    const b = await at(page, 0.5, 0.6);
    await drag(page, a, b);
    const [r] = await annots(page);
    const p = await toPdf(page, a);
    const q = await toPdf(page, b);
    expect(Math.abs(r.rect.x0 - Math.min(p.x, q.x))).toBeLessThan(1);
    expect(Math.abs(r.rect.x1 - Math.max(p.x, q.x))).toBeLessThan(1);
    expect(Math.abs(r.rect.y0 - Math.min(p.y, q.y))).toBeLessThan(1);
    expect(Math.abs(r.rect.y1 - Math.max(p.y, q.y))).toBeLessThan(1);
    // Drawn where it was dragged.
    const g = (await page.locator(`#viewer .markup-overlay [data-annot-id="${r.id}"]`).boundingBox())!;
    expect(Math.abs(g.x - a.x)).toBeLessThan(1.5);
    expect(Math.abs(g.y - a.y)).toBeLessThan(1.5);
    expect(Math.abs(g.x + g.width - b.x)).toBeLessThan(1.5);
    expect(Math.abs(g.y + g.height - b.y)).toBeLessThan(1.5);

    await page.click('[data-markup="text"]');
    const c = await at(page, 0.2, 0.75);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type('upright');
    await page.keyboard.press('Escape');
    const box = (await annots(page))[1];
    expect(box.kind).toBe('text');
    expect(box.angle).toBe(90);
    const el = (await page.locator(`#viewer .markup-overlay [data-annot-id="${box.id}"]`).boundingBox())!;
    // Upright: one line of text is wider than tall on screen, starting at the click.
    expect(el.width).toBeGreaterThan(el.height * 2);
    expect(Math.abs(el.x - c.x)).toBeLessThan(1.5);
    expect(Math.abs(el.y - c.y)).toBeLessThan(1.5);
  });

  test('while a tool is armed the text layer is not selectable; with Text Selection it is', async ({ page }) => {
    await openFit(page);
    await page.waitForSelector('#viewer .page[data-page="1"] .textLayer span');
    const span = (await page.locator('#viewer .page[data-page="1"] .textLayer span').nth(1).boundingBox())!;
    await page.click('[data-markup="draw"]');
    expect(await page.locator('#viewer .page[data-page="1"]').evaluate((el) => getComputedStyle(el).cursor)).toBe('crosshair');
    await drag(page, { x: span.x + 2, y: span.y + span.height / 2 }, { x: span.x + span.width - 2, y: span.y + span.height / 2 });
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
    expect(await annots(page)).toHaveLength(1);
    await page.keyboard.press('Escape');
    await drag(page, { x: span.x + 2, y: span.y + span.height / 2 }, { x: span.x + span.width - 2, y: span.y + span.height / 2 });
    expect((await page.evaluate(() => getSelection()?.toString() ?? '')).length).toBeGreaterThan(3);
    expect(await annots(page)).toHaveLength(1);
  });
});
