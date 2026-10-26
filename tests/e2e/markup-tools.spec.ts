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
