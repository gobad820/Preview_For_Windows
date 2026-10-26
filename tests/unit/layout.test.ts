import { describe, expect, test } from 'vitest';
import {
  CSS_UNITS,
  anchoredScroll,
  anchoredScrollTop,
  computeLayout,
  currentPageIndex,
  docPointAt,
  fitPageScale,
  fitWidthScale,
  rotatedSize,
  rowOfPage,
  scrollTopForPage,
  stepRow,
  visibleRange,
  yForDocPoint,
  type Layout,
  type LayoutOptions,
  type PageSize,
  type Rotation,
  type Spread,
} from '../../src/viewer/layout';

const A4: PageSize = { width: 595, height: 842 };
const LANDSCAPE: PageSize = { width: 842, height: 595 };
const SMALL: PageSize = { width: 200, height: 200 };
const MIXED = [A4, LANDSCAPE, SMALL];

const GAP = 16;
const PADDING = 24;
const CONTAINER_WIDTH = 1000;
const VIEWPORT_HEIGHT = 800;

const opts = (overrides: Partial<LayoutOptions> = {}): LayoutOptions => ({
  scale: 1,
  rotation: 0,
  gap: GAP,
  padding: PADDING,
  containerWidth: CONTAINER_WIDTH,
  ...overrides,
});

const px = (pt: number, scale = 1) => pt * scale * CSS_UNITS;

const A4_W = px(595); // 793.33
const A4_H = px(842); // 1122.67

const threeA4 = (): Layout => computeLayout([A4, A4, A4], opts());

describe('CSS_UNITS', () => {
  test('is 96/72', () => {
    expect(CSS_UNITS).toBeCloseTo(96 / 72, 10);
  });
});

describe('rotatedSize', () => {
  test('keeps the size at 0 and 180', () => {
    expect(rotatedSize(A4, 0)).toEqual({ width: 595, height: 842 });
    expect(rotatedSize(A4, 180)).toEqual({ width: 595, height: 842 });
  });

  test('swaps width and height at 90 and 270', () => {
    expect(rotatedSize(A4, 90)).toEqual({ width: 842, height: 595 });
    expect(rotatedSize(A4, 270)).toEqual({ width: 842, height: 595 });
  });
});

describe('computeLayout', () => {
  test('stacks three A4 pages with exact rects', () => {
    const layout = threeA4();
    const left = (CONTAINER_WIDTH - A4_W) / 2; // 103.33

    expect(layout.pages).toHaveLength(3);
    const [p0, p1, p2] = layout.pages;
    expect(p0?.index).toBe(0);
    expect(p0?.top).toBeCloseTo(PADDING, 6);
    expect(p0?.left).toBeCloseTo(left, 6);
    expect(p0?.width).toBeCloseTo(A4_W, 6);
    expect(p0?.height).toBeCloseTo(A4_H, 6);

    expect(p1?.index).toBe(1);
    expect(p1?.top).toBeCloseTo(PADDING + A4_H + GAP, 6);
    expect(p1?.left).toBeCloseTo(left, 6);

    expect(p2?.index).toBe(2);
    expect(p2?.top).toBeCloseTo(PADDING + 2 * (A4_H + GAP), 6);
    expect(p2?.left).toBeCloseTo(left, 6);

    expect(layout.totalHeight).toBeCloseTo(PADDING + 3 * A4_H + 2 * GAP + PADDING, 6);
    expect(layout.contentWidth).toBe(CONTAINER_WIDTH);
    expect(layout.padding).toBe(PADDING);
  });

  test('widens content to the widest page and centers every page on the same axis', () => {
    const layout = computeLayout(MIXED, opts());
    const widest = px(842);
    const contentWidth = widest + 2 * PADDING; // 1170.67 > 1000

    expect(layout.contentWidth).toBeCloseTo(contentWidth, 6);
    for (const page of layout.pages) {
      expect(page.left + page.width / 2).toBeCloseTo(contentWidth / 2, 6);
    }
    expect(layout.pages[1]?.left).toBeCloseTo(PADDING, 6);
    expect(layout.pages[2]?.width).toBeCloseTo(px(200), 6);
    expect(layout.pages[2]?.height).toBeCloseTo(px(200), 6);
  });

  test('applies scale', () => {
    const layout = computeLayout([A4], opts({ scale: 2 }));
    expect(layout.pages[0]?.width).toBeCloseTo(px(595, 2), 6);
    expect(layout.pages[0]?.height).toBeCloseTo(px(842, 2), 6);
  });

  test('applies rotation before measuring', () => {
    const layout = computeLayout([A4], opts({ rotation: 90 }));
    expect(layout.pages[0]?.width).toBeCloseTo(px(842), 6);
    expect(layout.pages[0]?.height).toBeCloseTo(px(595), 6);
  });

  test('empty sizes yield an empty layout with padding only', () => {
    const layout = computeLayout([], opts());
    expect(layout.pages).toEqual([]);
    expect(layout.totalHeight).toBe(2 * PADDING);
    expect(layout.contentWidth).toBe(CONTAINER_WIDTH);
  });
});

describe('fitWidthScale', () => {
  test('fills the container minus padding with a single A4 page', () => {
    // (1000 - 48) / (595 * 96/72) = 1.2
    expect(fitWidthScale([A4], 0, CONTAINER_WIDTH, PADDING)).toBeCloseTo(1.2, 10);
  });

  test('uses the widest rotated page of a mixed set (842 pt)', () => {
    const expected = (CONTAINER_WIDTH - 2 * PADDING) / px(842);
    expect(fitWidthScale(MIXED, 0, CONTAINER_WIDTH, PADDING)).toBeCloseTo(expected, 10);
  });

  test('accounts for rotation', () => {
    const expected = (CONTAINER_WIDTH - 2 * PADDING) / px(842);
    expect(fitWidthScale([A4], 90, CONTAINER_WIDTH, PADDING)).toBeCloseTo(expected, 10);
  });
});

describe('fitPageScale', () => {
  test('is the min of width-fit and height-fit on a 1000x800 container', () => {
    const availW = CONTAINER_WIDTH - 2 * PADDING; // 952
    const availH = 800 - 2 * PADDING; // 752
    const widthFit = availW / px(842);
    const heightFit = availH / px(842);
    expect(fitPageScale(MIXED, 0, CONTAINER_WIDTH, 800, PADDING)).toBeCloseTo(
      Math.min(widthFit, heightFit),
      10,
    );
    expect(heightFit).toBeLessThan(widthFit);
  });

  test('picks width-fit for a wide short container', () => {
    const availW = 600 - 2 * PADDING;
    expect(fitPageScale([A4], 0, 600, 5000, PADDING)).toBeCloseTo(availW / px(595), 10);
  });
});

describe('visibleRange', () => {
  test('at scrollTop 0 with overscan 0 only the first page is visible', () => {
    expect(visibleRange(threeA4(), 0, VIEWPORT_HEIGHT, 0)).toEqual({ first: 0, last: 0 });
  });

  test('just below page 0 bottom starts at page 1', () => {
    const layout = threeA4();
    const bottom0 = PADDING + A4_H;
    expect(visibleRange(layout, bottom0 + 0.5, VIEWPORT_HEIGHT, 0)).toEqual({ first: 1, last: 1 });
  });

  test('spans two pages when the viewport straddles a gap', () => {
    expect(visibleRange(threeA4(), 1000, VIEWPORT_HEIGHT, 0)).toEqual({ first: 0, last: 1 });
  });

  test('overscan extends the range in both directions', () => {
    const layout = threeA4();
    const bottom0 = PADDING + A4_H;
    expect(visibleRange(layout, bottom0 + 0.5, VIEWPORT_HEIGHT, 10)).toEqual({ first: 0, last: 1 });
    expect(visibleRange(layout, 0, 1200, 0)).toEqual({ first: 0, last: 1 });
    expect(visibleRange(layout, 0, 1200, 2000)).toEqual({ first: 0, last: 2 });
  });

  test('returns null for an empty layout', () => {
    expect(visibleRange(computeLayout([], opts()), 0, VIEWPORT_HEIGHT, 0)).toBeNull();
  });

  test('returns null when nothing intersects', () => {
    expect(visibleRange(threeA4(), 10_000, VIEWPORT_HEIGHT, 0)).toBeNull();
  });
});

describe('currentPageIndex', () => {
  test('picks the page with the larger visible height', () => {
    const layout = threeA4();
    // [500, 1300]: page 0 shows 646.67, page 1 shows 137.33
    expect(currentPageIndex(layout, 500, VIEWPORT_HEIGHT)).toBe(0);
    // [1000, 1800]: page 0 shows 146.67, page 1 shows 637.33
    expect(currentPageIndex(layout, 1000, VIEWPORT_HEIGHT)).toBe(1);
  });

  test('ties go to the earlier page', () => {
    // 150x300 pt → 200x400 px; page 0 [24, 424], page 1 [440, 840]
    const layout = computeLayout([{ width: 150, height: 300 }, { width: 150, height: 300 }], opts());
    // viewport [232, 632]: both show 192 px
    expect(currentPageIndex(layout, 232, 400)).toBe(0);
  });

  test('returns -1 for an empty layout', () => {
    expect(currentPageIndex(computeLayout([], opts()), 0, VIEWPORT_HEIGHT)).toBe(-1);
  });

  test('returns the last page when scrolled past the end', () => {
    expect(currentPageIndex(threeA4(), 10_000, VIEWPORT_HEIGHT)).toBe(2);
  });
});

describe('scrollTopForPage', () => {
  test('is the page top minus padding, clamped at 0', () => {
    const layout = threeA4();
    expect(scrollTopForPage(layout, 0)).toBe(0);
    expect(scrollTopForPage(layout, 1)).toBeCloseTo(PADDING + A4_H + GAP - PADDING, 6);
  });

  test('clamps the index into range', () => {
    const layout = threeA4();
    expect(scrollTopForPage(layout, -5)).toBe(0);
    expect(scrollTopForPage(layout, 99)).toBeCloseTo(scrollTopForPage(layout, 2), 6);
  });

  test('is 0 for an empty layout', () => {
    expect(scrollTopForPage(computeLayout([], opts()), 0)).toBe(0);
  });
});

describe('docPointAt / yForDocPoint', () => {
  test('round-trips a point inside a page', () => {
    const layout = threeA4();
    const y = 1500;
    const point = docPointAt(layout, y);
    expect(point.index).toBe(1);
    expect(point.fraction).toBeCloseTo((y - (PADDING + A4_H + GAP)) / A4_H, 10);
    expect(yForDocPoint(layout, point)).toBeCloseTo(y, 6);
  });

  test('in a gap resolves to the next page at fraction 0', () => {
    const layout = threeA4();
    const inGap = PADDING + A4_H + GAP / 2;
    expect(docPointAt(layout, inGap)).toEqual({ index: 1, fraction: 0 });
    expect(yForDocPoint(layout, { index: 1, fraction: 0 })).toBeCloseTo(PADDING + A4_H + GAP, 6);
  });

  test('before the first page resolves to page 0 at fraction 0', () => {
    expect(docPointAt(threeA4(), 0)).toEqual({ index: 0, fraction: 0 });
  });

  test('beyond the end resolves to the last page at fraction 1', () => {
    const layout = threeA4();
    expect(docPointAt(layout, 10_000)).toEqual({ index: 2, fraction: 1 });
    expect(yForDocPoint(layout, { index: 2, fraction: 1 })).toBeCloseTo(layout.totalHeight - PADDING, 6);
  });

  test('empty layout maps to index -1 and y 0', () => {
    const layout = computeLayout([], opts());
    expect(docPointAt(layout, 100)).toEqual({ index: -1, fraction: 0 });
    expect(yForDocPoint(layout, { index: 0, fraction: 0.5 })).toBe(0);
  });
});

describe('anchoredScrollTop', () => {
  test('keeps page 1 fraction 0.5 fixed when scale doubles', () => {
    const oldLayout = threeA4();
    const newLayout = computeLayout([A4, A4, A4], opts({ scale: 2 }));
    const oldMid = PADDING + A4_H + GAP + A4_H / 2;
    const newMid = PADDING + 2 * A4_H + GAP + A4_H; // page 1 top + half of 2*A4_H

    expect(anchoredScrollTop(oldLayout, newLayout, oldMid, 0)).toBeCloseTo(newMid, 6);
    expect(docPointAt(newLayout, anchoredScrollTop(oldLayout, newLayout, oldMid, 0))).toEqual({
      index: 1,
      fraction: expect.closeTo(0.5, 10) as number,
    });
  });

  test('honours the anchor offset', () => {
    const oldLayout = threeA4();
    const newLayout = computeLayout([A4, A4, A4], opts({ scale: 2 }));
    const oldMid = PADDING + A4_H + GAP + A4_H / 2;
    const newMid = PADDING + 2 * A4_H + GAP + A4_H;
    const offset = 400;

    expect(anchoredScrollTop(oldLayout, newLayout, oldMid - offset, offset)).toBeCloseTo(
      newMid - offset,
      6,
    );
  });

  test('clamps at 0', () => {
    const oldLayout = threeA4();
    const newLayout = computeLayout([A4, A4, A4], opts({ scale: 0.5 }));
    expect(anchoredScrollTop(oldLayout, newLayout, 0, 400)).toBe(0);
  });

  test('is 0 for empty layouts', () => {
    const empty = computeLayout([], opts());
    expect(anchoredScrollTop(empty, empty, 100, 50)).toBe(0);
  });
});

describe('two-page rows', () => {
  const PAGE: PageSize = { width: 600, height: 800 };
  const SPINE = 8;
  const W = px(600); // 800
  const H = px(800); // 1066.67
  const four = (spread: Spread = 'pairs') => computeLayout([PAGE, PAGE, PAGE, PAGE], opts({ spread, spineGap: SPINE }));

  test('pairs put two pages per row, meeting at the spine gap', () => {
    const layout = four();
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows[0]).toMatchObject({ first: 0, last: 1 });
    expect(layout.rows[1]).toMatchObject({ first: 2, last: 3 });
    const [p0, p1, p2] = layout.pages;
    expect(p1!.left - (p0!.left + p0!.width)).toBeCloseTo(SPINE, 6);
    expect(p0!.top).toBeCloseTo(p1!.top, 6);
    expect(p2!.top).toBeCloseTo(PADDING + H + GAP, 6);
    expect(layout.totalHeight).toBeCloseTo(PADDING + 2 * H + GAP + PADDING, 6);
  });

  test('the spine is the horizontal center of the content', () => {
    const layout = four();
    // 2 × 800 + 8 + 2 × 24 = 1656 > 1000
    expect(layout.contentWidth).toBeCloseTo(2 * W + SPINE + 2 * PADDING, 6);
    const spine = layout.contentWidth / 2;
    expect(layout.pages[0]!.left + layout.pages[0]!.width).toBeCloseTo(spine - SPINE / 2, 6);
    expect(layout.pages[1]!.left).toBeCloseTo(spine + SPINE / 2, 6);
  });

  test('a lone last page sits on the left of the spine', () => {
    const layout = computeLayout([PAGE, PAGE, PAGE], opts({ spread: 'pairs', spineGap: SPINE }));
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows[1]).toMatchObject({ first: 2, last: 2 });
    const spine = layout.contentWidth / 2;
    expect(layout.pages[2]!.left + layout.pages[2]!.width).toBeCloseTo(spine - SPINE / 2, 6);
  });

  test('book mode puts the first page alone on the right', () => {
    const layout = four('book');
    expect(layout.rows.map((r) => [r.first, r.last])).toEqual([[0, 0], [1, 2], [3, 3]]);
    const spine = layout.contentWidth / 2;
    expect(layout.pages[0]!.left).toBeGreaterThanOrEqual(spine);
    expect(layout.pages[1]!.left + layout.pages[1]!.width).toBeCloseTo(spine - SPINE / 2, 6);
    expect(layout.pages[2]!.left).toBeCloseTo(spine + SPINE / 2, 6);
    expect(layout.pages[3]!.left + layout.pages[3]!.width).toBeCloseTo(spine - SPINE / 2, 6);
  });

  test('pages of different heights in one row share a vertical center', () => {
    const layout = computeLayout([A4, LANDSCAPE], opts({ spread: 'pairs', spineGap: SPINE }));
    const [p0, p1] = layout.pages;
    expect(p0!.top + p0!.height / 2).toBeCloseTo(p1!.top + p1!.height / 2, 6);
    expect(layout.rows[0]!.height).toBeCloseTo(px(842), 6);
    expect(p0!.top).toBeCloseTo(PADDING, 6); // the taller page starts at the row top
    expect(p1!.top).toBeGreaterThan(p0!.top);
  });

  test('continuous scroll is rows of one', () => {
    const layout = threeA4();
    expect(layout.rows.map((r) => [r.first, r.last])).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(layout.rows[1]!.top).toBeCloseTo(layout.pages[1]!.top, 6);
  });

  test('rowOfPage finds the row holding a page', () => {
    const layout = four();
    expect(rowOfPage(layout, 0)).toBe(0);
    expect(rowOfPage(layout, 1)).toBe(0);
    expect(rowOfPage(layout, 3)).toBe(1);
    expect(rowOfPage(four('book'), 0)).toBe(0);
    expect(rowOfPage(four('book'), 1)).toBe(1);
    expect(rowOfPage(four('book'), 3)).toBe(2);
    expect(rowOfPage(threeA4(), 2)).toBe(2);
  });

  test('stepRow moves one row and clamps at the ends', () => {
    const layout = four();
    expect(stepRow(layout, 0, 1)).toBe(2);
    expect(stepRow(layout, 1, 1)).toBe(2);
    expect(stepRow(layout, 3, 1)).toBe(2);
    expect(stepRow(layout, 3, -1)).toBe(0);
    expect(stepRow(layout, 0, -1)).toBe(0);
    expect(stepRow(four('book'), 0, 1)).toBe(1);
    expect(stepRow(four('book'), 2, 1)).toBe(3);
    expect(stepRow(threeA4(), 1, 1)).toBe(2);
    expect(stepRow(threeA4(), 1, -1)).toBe(0);
  });

  test('fitWidthScale fits both pages of a row', () => {
    const single = fitWidthScale([PAGE], 0, CONTAINER_WIDTH, PADDING);
    const pairs = fitWidthScale([PAGE, PAGE], 0, CONTAINER_WIDTH, PADDING, 'pairs', SPINE);
    expect(pairs).toBeCloseTo((CONTAINER_WIDTH - 2 * PADDING - SPINE) / (2 * W), 10);
    expect(pairs).toBeLessThan(single / 2);
    const layout = computeLayout([PAGE, PAGE], opts({ scale: pairs, spread: 'pairs', spineGap: SPINE }));
    expect(layout.contentWidth).toBeCloseTo(CONTAINER_WIDTH, 6);
    expect(layout.pages[0]!.left).toBeCloseTo(PADDING, 6);
    expect(layout.pages[1]!.left + layout.pages[1]!.width).toBeCloseTo(CONTAINER_WIDTH - PADDING, 6);
  });

  test('fitPageScale fits a whole row', () => {
    const scale = fitPageScale([PAGE, PAGE], 0, CONTAINER_WIDTH, 2000, PADDING, 'pairs', SPINE);
    expect(scale).toBeCloseTo((CONTAINER_WIDTH - 2 * PADDING - SPINE) / (2 * W), 10);
    const short = fitPageScale([PAGE, PAGE], 0, CONTAINER_WIDTH, 500, PADDING, 'pairs', SPINE);
    expect(short).toBeCloseTo((500 - 2 * PADDING) / H, 10);
  });

  test('visibleRange covers whole rows', () => {
    const layout = four();
    expect(visibleRange(layout, 0, VIEWPORT_HEIGHT, 0)).toEqual({ first: 0, last: 1 });
    expect(visibleRange(layout, PADDING + H + GAP / 2, VIEWPORT_HEIGHT, 0)).toEqual({ first: 2, last: 3 });
    expect(visibleRange(layout, 1000, VIEWPORT_HEIGHT, 0)).toEqual({ first: 0, last: 3 });
  });

  test('visibleRange finds rows whose pages are not in top order', () => {
    // Row 0: landscape (short) then portrait (tall): page 1's top is above page 0's.
    const layout = computeLayout([LANDSCAPE, A4, A4, A4], opts({ spread: 'pairs', spineGap: SPINE }));
    expect(layout.pages[1]!.top).toBeLessThan(layout.pages[0]!.top);
    expect(visibleRange(layout, 30, 10, 0)).toEqual({ first: 0, last: 1 });
  });

  test('currentPageIndex returns the left page when both pages are fully visible', () => {
    const layout = computeLayout([SMALL, SMALL, SMALL, SMALL], opts({ spread: 'pairs', spineGap: SPINE }));
    expect(layout.rows[0]).toMatchObject({ first: 0, last: 1 });
    expect(currentPageIndex(layout, 0, VIEWPORT_HEIGHT)).toBe(0);
  });

  test('currentPageIndex returns the left page of the most visible row', () => {
    const layout = four();
    expect(currentPageIndex(layout, 300, VIEWPORT_HEIGHT)).toBe(0);
    expect(currentPageIndex(layout, 1000, VIEWPORT_HEIGHT)).toBe(2);
    // Row 0 of a mixed pair: the right (landscape) page is shorter but the row still counts once.
    const mixed = computeLayout([A4, LANDSCAPE, A4, A4], opts({ spread: 'pairs', spineGap: SPINE }));
    expect(currentPageIndex(mixed, 0, VIEWPORT_HEIGHT)).toBe(0);
  });

  test('scrollTopForPage goes to the row top', () => {
    const layout = computeLayout([A4, LANDSCAPE, A4, A4], opts({ spread: 'pairs', spineGap: SPINE }));
    expect(scrollTopForPage(layout, 1)).toBe(0);
    expect(scrollTopForPage(layout, 3)).toBeCloseTo(layout.rows[1]!.top - PADDING, 6);
  });

  test('docPointAt picks the page of the row under x and round-trips', () => {
    const layout = four();
    const y = PADDING + H / 2;
    const spine = layout.contentWidth / 2;
    expect(docPointAt(layout, y).index).toBe(0);
    expect(docPointAt(layout, y, spine - 100).index).toBe(0);
    const right = docPointAt(layout, y, spine + 100);
    expect(right.index).toBe(1);
    expect(right.fraction).toBeCloseTo(0.5, 10);
    expect(yForDocPoint(layout, right)).toBeCloseTo(y, 6);
    expect(docPointAt(layout, PADDING + H + GAP + 10, spine + 50).index).toBe(3);
  });

  test('docPointAt uses the page that spans y when the row mixes heights', () => {
    const layout = computeLayout([LANDSCAPE, A4], opts({ spread: 'pairs', spineGap: SPINE }));
    expect(layout.rows).toHaveLength(1);
    // Above the landscape page but inside the portrait one.
    const y = layout.pages[1]!.top + 10;
    expect(docPointAt(layout, y).index).toBe(1);
  });

  test('anchoredScroll keeps the point under the anchor fixed in both directions', () => {
    const oldLayout = four();
    const newLayout = computeLayout([PAGE, PAGE, PAGE, PAGE], opts({ scale: 2, spread: 'pairs', spineGap: SPINE }));
    const scroll = { top: 100, left: 300 };
    const anchor = { x: 700, y: 400 };
    const docX = scroll.left + anchor.x; // on page 1 (right of the spine at 828)
    const point = docPointAt(oldLayout, scroll.top + anchor.y, docX);
    expect(point.index).toBe(1);
    const fx = (docX - oldLayout.pages[1]!.left) / oldLayout.pages[1]!.width;

    const next = anchoredScroll(oldLayout, newLayout, scroll, anchor);
    const after = docPointAt(newLayout, next.top + anchor.y, next.left + anchor.x);
    expect(after.index).toBe(1);
    expect(after.fraction).toBeCloseTo(point.fraction, 10);
    const p1 = newLayout.pages[1]!;
    expect((next.left + anchor.x - p1.left) / p1.width).toBeCloseTo(fx, 10);
  });

  test('anchoredScroll clamps at 0 and is 0 for empty layouts', () => {
    const empty = computeLayout([], opts());
    expect(anchoredScroll(empty, empty, { top: 100, left: 100 }, { x: 10, y: 10 })).toEqual({ top: 0, left: 0 });
    const oldLayout = threeA4();
    const small = computeLayout([A4, A4, A4], opts({ scale: 0.5 }));
    expect(anchoredScroll(oldLayout, small, { top: 0, left: 0 }, { x: 500, y: 400 }).top).toBe(0);
  });
});

// Type-level check: Rotation and PageSize are re-exported from layout.ts.
const _rotation: Rotation = 270;
const _size: PageSize = { width: 1, height: 1 };
void _rotation;
void _size;
