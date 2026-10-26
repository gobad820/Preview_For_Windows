import { describe, expect, test } from 'vitest';
import {
  CSS_UNITS,
  anchoredScrollTop,
  computeLayout,
  currentPageIndex,
  docPointAt,
  fitPageScale,
  fitWidthScale,
  rotatedSize,
  scrollTopForPage,
  visibleRange,
  yForDocPoint,
  type Layout,
  type LayoutOptions,
  type PageSize,
  type Rotation,
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

// Type-level check: Rotation and PageSize are re-exported from layout.ts.
const _rotation: Rotation = 270;
const _size: PageSize = { width: 1, height: 1 };
void _rotation;
void _size;
