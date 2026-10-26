/**
 * Pure page-layout math for the continuous-scroll viewer. All outputs are CSS px.
 * No DOM, no pdf.js: everything here is testable in Node.
 */
import type { PageSize, Rotation } from '../types';

export type { PageSize, Rotation } from '../types';

/** CSS px per PDF point: 96 dpi / 72 pt-per-inch. */
export const CSS_UNITS = 96 / 72;

export interface LayoutOptions {
  /** 1.0 = 100%. */
  scale: number;
  rotation: Rotation;
  /** Vertical space between pages, CSS px. */
  gap: number;
  /** Space around the page stack on every side, CSS px. */
  padding: number;
  /** Width of the scroll container, CSS px. */
  containerWidth: number;
}

export interface PageRect {
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Layout {
  pages: PageRect[];
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

export function computeLayout(sizes: PageSize[], opts: LayoutOptions): Layout {
  const { scale, rotation, gap, padding, containerWidth } = opts;
  const factor = scale * CSS_UNITS;

  const dims = sizes.map((size) => {
    const r = rotatedSize(size, rotation);
    return { width: r.width * factor, height: r.height * factor };
  });

  const maxWidth = dims.reduce((acc, d) => Math.max(acc, d.width), 0);
  const contentWidth = Math.max(containerWidth, maxWidth + 2 * padding);

  const pages: PageRect[] = [];
  let top = padding;
  for (let index = 0; index < dims.length; index++) {
    const d = dims[index]!;
    pages.push({
      index,
      top,
      left: (contentWidth - d.width) / 2,
      width: d.width,
      height: d.height,
    });
    top += d.height + (index < dims.length - 1 ? gap : 0);
  }

  return { pages, totalHeight: top + padding, contentWidth, padding };
}

export function fitWidthScale(
  sizes: PageSize[],
  rotation: Rotation,
  containerWidth: number,
  padding: number,
): number {
  const { width } = maxRotatedDims(sizes, rotation);
  if (width <= 0) return 1;
  return (containerWidth - 2 * padding) / (width * CSS_UNITS);
}

export function fitPageScale(
  sizes: PageSize[],
  rotation: Rotation,
  containerWidth: number,
  containerHeight: number,
  padding: number,
): number {
  const { width, height } = maxRotatedDims(sizes, rotation);
  if (width <= 0 || height <= 0) return 1;
  const widthFit = (containerWidth - 2 * padding) / (width * CSS_UNITS);
  const heightFit = (containerHeight - 2 * padding) / (height * CSS_UNITS);
  return Math.min(widthFit, heightFit);
}

/** Index of the first page whose bottom edge is below `y` (pages.length when none). */
function firstPageEndingAfter(pages: PageRect[], y: number): number {
  let lo = 0;
  let hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid]!;
    if (p.top + p.height > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Index of the last page whose top edge is above `y` (-1 when none). */
function lastPageStartingBefore(pages: PageRect[], y: number): number {
  let lo = 0;
  let hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid]!.top < y) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function visibleRange(
  layout: Layout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): PageRange | null {
  const { pages } = layout;
  if (pages.length === 0) return null;

  const start = scrollTop - overscan;
  const end = scrollTop + viewportHeight + overscan;
  const first = firstPageEndingAfter(pages, start);
  const last = lastPageStartingBefore(pages, end);
  if (first >= pages.length || last < 0 || first > last) return null;
  return { first, last };
}

export function currentPageIndex(layout: Layout, scrollTop: number, viewportHeight: number): number {
  const { pages } = layout;
  if (pages.length === 0) return -1;

  const range = visibleRange(layout, scrollTop, viewportHeight, 0);
  if (range === null) {
    // Nothing intersects (e.g. scrolled past the end): nearest preceding page.
    return Math.max(0, lastPageStartingBefore(pages, scrollTop));
  }

  const viewportBottom = scrollTop + viewportHeight;
  let best = range.first;
  let bestVisible = -1;
  for (let i = range.first; i <= range.last; i++) {
    const p = pages[i]!;
    const visible = Math.min(p.top + p.height, viewportBottom) - Math.max(p.top, scrollTop);
    if (visible > bestVisible) {
      bestVisible = visible;
      best = i;
    }
  }
  return best;
}

function clampIndex(layout: Layout, index: number): number {
  return Math.min(Math.max(0, index), layout.pages.length - 1);
}

export function scrollTopForPage(layout: Layout, index: number): number {
  if (layout.pages.length === 0) return 0;
  const page = layout.pages[clampIndex(layout, index)]!;
  return Math.max(0, page.top - layout.padding);
}

export function docPointAt(layout: Layout, y: number): DocPoint {
  const { pages } = layout;
  if (pages.length === 0) return { index: -1, fraction: 0 };

  const index = firstPageEndingAfter(pages, y);
  if (index >= pages.length) return { index: pages.length - 1, fraction: 1 };

  const page = pages[index]!;
  if (y <= page.top) return { index, fraction: 0 };
  const fraction = Math.min(1, Math.max(0, (y - page.top) / page.height));
  return { index, fraction };
}

export function yForDocPoint(layout: Layout, point: DocPoint): number {
  if (layout.pages.length === 0 || point.index < 0) return 0;
  const page = layout.pages[clampIndex(layout, point.index)]!;
  const fraction = Math.min(1, Math.max(0, point.fraction));
  return page.top + fraction * page.height;
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
