/**
 * Pure page-layout math for the continuous-scroll viewer. All outputs are CSS px.
 * No DOM, no pdf.js: everything here is testable in Node.
 *
 * Pages sit in rows: one per row in Continuous Scroll, two per row in Two Pages. Searches
 * run over rows (their tops always increase); page tops inside a row may not.
 */
import type { PageSize, Rotation } from '../types';

export type { PageSize, Rotation } from '../types';

/** CSS px per PDF point: 96 dpi / 72 pt-per-inch. */
export const CSS_UNITS = 96 / 72;

/** One page per row; two per row (1–2, 3–4, …); or two per row after a lone first page (book). */
export type Spread = 'none' | 'pairs' | 'book';

export interface LayoutOptions {
  /** 1.0 = 100%. */
  scale: number;
  rotation: Rotation;
  /** Vertical space between rows, CSS px. */
  gap: number;
  /** Space around the page stack on every side, CSS px. */
  padding: number;
  /** Width of the scroll container, CSS px. */
  containerWidth: number;
  /** Default 'none'. */
  spread?: Spread;
  /** Horizontal space between the two pages of a row, CSS px; default 0. */
  spineGap?: number;
}

export interface PageRect {
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** A row of pages: `first`..`last` (one or two pages), vertically centered in it. */
export interface RowRect {
  top: number;
  height: number;
  first: number;
  last: number;
}

export interface Layout {
  pages: PageRect[];
  rows: RowRect[];
  totalHeight: number;
  contentWidth: number;
  padding: number;
}

export interface DocPoint {
  /** Page index; -1 for an empty layout. */
  index: number;
  /** Position within the page as a fraction of its height, 0–1. */
  fraction: number;
}

export interface PageRange {
  first: number;
  last: number;
}

export function rotatedSize(size: PageSize, rotation: Rotation): PageSize {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/** Largest rotated width and height across `sizes`, in PDF points (0 when empty). */
function maxRotatedDims(sizes: PageSize[], rotation: Rotation): PageSize {
  let width = 0;
  let height = 0;
  for (const size of sizes) {
    const r = rotatedSize(size, rotation);
    if (r.width > width) width = r.width;
    if (r.height > height) height = r.height;
  }
  return { width, height };
}

/** [first, last] page indices of each row. */
function rowSpans(count: number, spread: Spread): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  if (spread === 'book' && count > 0) {
    spans.push([0, 0]);
    i = 1;
  }
  const step = spread === 'none' ? 1 : 2;
  for (; i < count; i += step) spans.push([i, Math.min(i + step, count) - 1]);
  return spans;
}

export function computeLayout(sizes: PageSize[], opts: LayoutOptions): Layout {
  const { scale, rotation, gap, padding, containerWidth } = opts;
  const spread = opts.spread ?? 'none';
  const spineGap = spread === 'none' ? 0 : (opts.spineGap ?? 0);
  const factor = scale * CSS_UNITS;

  const dims = sizes.map((size) => {
    const r = rotatedSize(size, rotation);
    return { width: r.width * factor, height: r.height * factor };
  });

  const maxWidth = dims.reduce((acc, d) => Math.max(acc, d.width), 0);
  const rowWidth = spread === 'none' ? maxWidth : 2 * maxWidth + spineGap;
  const contentWidth = Math.max(containerWidth, rowWidth + 2 * padding);
  const spine = contentWidth / 2;

  const pages: PageRect[] = [];
  const rows: RowRect[] = [];
  let top = padding;
  const spans = rowSpans(dims.length, spread);
  spans.forEach(([first, last], r) => {
    let height = 0;
    for (let i = first; i <= last; i++) height = Math.max(height, dims[i]!.height);
    for (let i = first; i <= last; i++) {
      const d = dims[i]!;
      // The left page ends at the spine, the right one starts there; a lone page is a left
      // page except the book cover.
      const onRight = i > first || (spread === 'book' && i === 0);
      const left =
        spread === 'none' ? (contentWidth - d.width) / 2 : onRight ? spine + spineGap / 2 : spine - spineGap / 2 - d.width;
      pages.push({ index: i, top: top + (height - d.height) / 2, left, width: d.width, height: d.height });
    }
    rows.push({ top, height, first, last });
    top += height + (r < spans.length - 1 ? gap : 0);
  });

  return { pages, rows, totalHeight: top + padding, contentWidth, padding };
}

/** Fit factor for rows of the widest page: one page, or two side by side across the spine gap. */
function widthFit(width: number, containerWidth: number, padding: number, spread: Spread, spineGap: number): number {
  if (spread === 'none') return (containerWidth - 2 * padding) / (width * CSS_UNITS);
  return (containerWidth - 2 * padding - spineGap) / (2 * width * CSS_UNITS);
}

export function fitWidthScale(
  sizes: PageSize[],
  rotation: Rotation,
  containerWidth: number,
  padding: number,
  spread: Spread = 'none',
  spineGap = 0,
): number {
  const { width } = maxRotatedDims(sizes, rotation);
  if (width <= 0) return 1;
  return widthFit(width, containerWidth, padding, spread, spineGap);
}

export function fitPageScale(
  sizes: PageSize[],
  rotation: Rotation,
  containerWidth: number,
  containerHeight: number,
  padding: number,
  spread: Spread = 'none',
  spineGap = 0,
): number {
  const { width, height } = maxRotatedDims(sizes, rotation);
  if (width <= 0 || height <= 0) return 1;
  const heightFit = (containerHeight - 2 * padding) / (height * CSS_UNITS);
  return Math.min(widthFit(width, containerWidth, padding, spread, spineGap), heightFit);
}

/** Index of the first row whose bottom edge is below `y` (rows.length when none). */
function firstRowEndingAfter(rows: RowRect[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid]!;
    if (r.top + r.height > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Index of the last row whose top edge is above `y` (-1 when none). */
function lastRowStartingBefore(rows: RowRect[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.top < y) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function clampIndex(layout: Layout, index: number): number {
  return Math.min(Math.max(0, index), layout.pages.length - 1);
}

/** Row holding page `index` (clamped into range); -1 for an empty layout. */
export function rowOfPage(layout: Layout, index: number): number {
  const { rows } = layout;
  if (rows.length === 0) return -1;
  const i = clampIndex(layout, index);
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.first <= i) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** First page of the row after (dir 1) or before (dir -1) the row holding `index`; clamped. */
export function stepRow(layout: Layout, index: number, dir: 1 | -1): number {
  const { rows } = layout;
  if (rows.length === 0) return 0;
  const r = Math.min(Math.max(0, rowOfPage(layout, index) + dir), rows.length - 1);
  return rows[r]!.first;
}

/** Rows intersecting [start, end]; null when none. */
function visibleRows(layout: Layout, start: number, end: number): PageRange | null {
  const { rows } = layout;
  const first = firstRowEndingAfter(rows, start);
  const last = lastRowStartingBefore(rows, end);
  if (first >= rows.length || last < 0 || first > last) return null;
  return { first, last };
}

export function visibleRange(
  layout: Layout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): PageRange | null {
  const rows = visibleRows(layout, scrollTop - overscan, scrollTop + viewportHeight + overscan);
  if (rows === null) return null;
  return { first: layout.rows[rows.first]!.first, last: layout.rows[rows.last]!.last };
}

/** The first (left) page of the row with the largest visible height; earlier rows win ties. */
export function currentPageIndex(layout: Layout, scrollTop: number, viewportHeight: number): number {
  const { rows } = layout;
  if (rows.length === 0) return -1;

  const range = visibleRows(layout, scrollTop, scrollTop + viewportHeight);
  if (range === null) {
    // Nothing intersects (e.g. scrolled past the end): nearest preceding row.
    return rows[Math.max(0, lastRowStartingBefore(rows, scrollTop))]!.first;
  }

  const viewportBottom = scrollTop + viewportHeight;
  let best = range.first;
  let bestVisible = -1;
  for (let i = range.first; i <= range.last; i++) {
    const r = rows[i]!;
    const visible = Math.min(r.top + r.height, viewportBottom) - Math.max(r.top, scrollTop);
    if (visible > bestVisible) {
      bestVisible = visible;
      best = i;
    }
  }
  return rows[best]!.first;
}

export function scrollTopForPage(layout: Layout, index: number): number {
  if (layout.pages.length === 0) return 0;
  const row = layout.rows[rowOfPage(layout, index)]!;
  return Math.max(0, row.top - layout.padding);
}

/**
 * The page of `row` a point belongs to: the one nearest `x` when given, else the first
 * whose vertical extent holds `y`, else the first.
 */
function pageInRow(layout: Layout, row: RowRect, y: number, x?: number): PageRect {
  let best = layout.pages[row.first]!;
  if (x !== undefined) {
    let bestDistance = Infinity;
    for (let i = row.first; i <= row.last; i++) {
      const p = layout.pages[i]!;
      const distance = Math.max(0, p.left - x, x - (p.left + p.width));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = p;
      }
    }
    return best;
  }
  for (let i = row.first; i <= row.last; i++) {
    const p = layout.pages[i]!;
    if (y >= p.top && y <= p.top + p.height) return p;
  }
  return best;
}

/** The page point at document `y` (and `x`, which picks the page within a two-page row). */
export function docPointAt(layout: Layout, y: number, x?: number): DocPoint {
  const { rows } = layout;
  if (rows.length === 0) return { index: -1, fraction: 0 };

  const r = firstRowEndingAfter(rows, y);
  if (r >= rows.length) return { index: pageInRow(layout, rows[rows.length - 1]!, y, x).index, fraction: 1 };

  const page = pageInRow(layout, rows[r]!, y, x);
  if (y <= page.top) return { index: page.index, fraction: 0 };
  const fraction = Math.min(1, Math.max(0, (y - page.top) / page.height));
  return { index: page.index, fraction };
}

export function yForDocPoint(layout: Layout, point: DocPoint): number {
  if (layout.pages.length === 0 || point.index < 0) return 0;
  const page = layout.pages[clampIndex(layout, point.index)]!;
  const fraction = Math.min(1, Math.max(0, point.fraction));
  return page.top + fraction * page.height;
}

/**
 * The scrollLeft that shows page `index` (with the layout padding around it) by scrolling as
 * little as possible: unchanged when it is in view, or when it is wider than the viewport
 * and covers it.
 */
export function scrollLeftToReveal(layout: Layout, index: number, scrollLeft: number, viewportWidth: number): number {
  if (layout.pages.length === 0) return scrollLeft;
  const page = layout.pages[clampIndex(layout, index)]!;
  const left = Math.max(0, page.left - layout.padding);
  const right = Math.min(layout.contentWidth, page.left + page.width + layout.padding);
  const fits = right - left <= viewportWidth;
  if (fits ? left < scrollLeft : left > scrollLeft) return left;
  if (fits ? right > scrollLeft + viewportWidth : right < scrollLeft + viewportWidth) return Math.max(0, right - viewportWidth);
  return scrollLeft;
}

export function anchoredScrollTop(
  oldLayout: Layout,
  newLayout: Layout,
  scrollTop: number,
  anchorOffset: number,
): number {
  const point = docPointAt(oldLayout, scrollTop + anchorOffset);
  return Math.max(0, yForDocPoint(newLayout, point) - anchorOffset);
}

/**
 * Scroll position for `newLayout` that keeps the point under `anchor` (viewport-relative) where
 * it was relative to its page: same page, same multiple of its width and height from its
 * corner, also for points in the margins, gaps and the blank space beside a shorter page.
 */
export function anchoredScroll(
  oldLayout: Layout,
  newLayout: Layout,
  scroll: { top: number; left: number },
  anchor: { x: number; y: number },
): { top: number; left: number } {
  const x = scroll.left + anchor.x;
  const y = scroll.top + anchor.y;
  const { index } = docPointAt(oldLayout, y, x);
  if (index < 0 || newLayout.pages.length === 0) return { top: 0, left: 0 };
  const from = oldLayout.pages[index]!;
  const to = newLayout.pages[clampIndex(newLayout, index)]!;
  const fx = from.width > 0 ? (x - from.left) / from.width : 0.5;
  const fy = from.height > 0 ? (y - from.top) / from.height : 0;
  return {
    top: Math.max(0, to.top + fy * to.height - anchor.y),
    left: Math.max(0, to.left + fx * to.width - anchor.x),
  };
}
