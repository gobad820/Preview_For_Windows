/**
 * Maps the outlines of a composition's source files onto composition
 * positions, for the sidebar's Table of Contents and for saving.
 */
import type { OutlineNode } from '../pdf/document';
import type { Composition } from './composition';

/** One source file's outline; `pageIndex` values are that file's page indices. */
export interface SourceOutline {
  src: number;
  nodes: OutlineNode[];
}

const keyOf = (src: number, index: number) => `${src}:${index}`;

/** Pre-order search for the first node with a destination. */
function firstPageIndex(nodes: OutlineNode[]): number | null {
  for (const n of nodes) {
    const found = n.pageIndex ?? firstPageIndex(n.children);
    if (found !== null) return found;
  }
  return null;
}

/**
 * A node's `pageIndex` becomes the first position showing its page, `top` kept.
 * A node whose page is gone is dropped unless a child survives; then it points at
 * the first surviving descendant with `top: null`. Nodes without a destination
 * survive only with surviving children. Sources contribute in the order of their
 * first page's position; sources without pages contribute nothing.
 */
export function remapOutline(outlines: SourceOutline[], pages: Composition): OutlineNode[] {
  const position = new Map<string, number>();
  const firstOfSource = new Map<number, number>();
  pages.forEach((p, i) => {
    const key = keyOf(p.src, p.index);
    if (!position.has(key)) position.set(key, i);
    if (!firstOfSource.has(p.src)) firstOfSource.set(p.src, i);
  });

  const remap = (src: number, nodes: OutlineNode[]): OutlineNode[] =>
    nodes.flatMap((n) => {
      const children = remap(src, n.children);
      if (n.pageIndex === null) return children.length > 0 ? [{ ...n, children }] : [];
      const pageIndex = position.get(keyOf(src, n.pageIndex));
      if (pageIndex !== undefined) return [{ ...n, pageIndex, children }];
      if (children.length === 0) return [];
      return [{ ...n, pageIndex: firstPageIndex(children), top: null, children }];
    });

  return outlines
    .filter((o) => firstOfSource.has(o.src))
    .sort((a, b) => firstOfSource.get(a.src)! - firstOfSource.get(b.src)!)
    .flatMap((o) => remap(o.src, o.nodes));
}
