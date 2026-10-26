import { describe, expect, test } from 'vitest';
import type { OutlineNode } from '../../src/pdf/document';
import { deletePages, fromSource, idSource, insertPages, movePages, type Composition } from '../../src/edit/composition';
import { remapOutline, type SourceOutline } from '../../src/edit/outlineRemap';

const node = (title: string, pageIndex: number | null, top: number | null = 700, children: OutlineNode[] = []) => ({
  title,
  pageIndex,
  top,
  children,
});

/** Compact view: "title@pageIndex" with children in brackets. */
function show(nodes: OutlineNode[]): string[] {
  return nodes.map((n) => {
    const kids = n.children.length ? ` [${show(n.children).join(', ')}]` : '';
    return `${n.title}@${n.pageIndex}${kids}`;
  });
}

/** Source 0 with 4 pages, ids 1..4. */
function fourPages(): { pages: Composition; next: () => number } {
  const next = idSource();
  return { pages: fromSource(0, 4, next), next };
}

const outline0: SourceOutline = {
  src: 0,
  nodes: [node('A', 0), node('B', 1, 500, [node('B1', 2), node('B2', 3)]), node('C', 3)],
};

describe('remapOutline', () => {
  test('keeps the outline unchanged for the untouched composition', () => {
    const { pages } = fourPages();
    expect(remapOutline([outline0], pages)).toEqual(outline0.nodes);
  });

  test('follows pages to their new positions and keeps top', () => {
    const { pages } = fourPages();
    const moved = movePages(pages, new Set([1]), 4); // order: 2,3,4,1
    const out = remapOutline([outline0], moved);
    expect(show(out)).toEqual(['A@3', 'B@0 [B1@1, B2@2]', 'C@2']);
    expect(out[1]!.top).toBe(500);
  });

  test('drops entries whose page was deleted', () => {
    const { pages } = fourPages();
    const out = remapOutline([outline0], deletePages(pages, new Set([1, 4]))); // pages 1,2 left
    expect(show(out)).toEqual(['B@0 [B1@1]']);
  });

  test('keeps an entry with a deleted page when a child survives, pointing at that child', () => {
    const { pages } = fourPages();
    const out = remapOutline([outline0], deletePages(pages, new Set([2, 3]))); // source pages 0,3 left
    expect(show(out)).toEqual(['A@0', 'B@1 [B2@1]', 'C@1']);
    expect(out[1]!.top).toBeNull();
    expect(out[1]!.children[0]!.top).toBe(700);
  });

  test('a kept entry points at its first surviving descendant, however deep', () => {
    const pages: Composition = [{ id: 1, src: 0, index: 5 }];
    const nodes = [node('X', 0, 1, [node('Y', 1, 2, [node('Z', 5, 3)]), node('W', 5, 4)])];
    expect(show(remapOutline([{ src: 0, nodes }], pages))).toEqual(['X@0 [Y@0 [Z@0], W@0]']);
  });

  test('a kept entry skips descendants without a destination', () => {
    const pages: Composition = [
      { id: 1, src: 0, index: 8 },
      { id: 2, src: 0, index: 5 },
    ];
    const nodes = [node('X', 0, 1, [node('Part', null, null, [node('Z', 5, 3)])])];
    expect(show(remapOutline([{ src: 0, nodes }], pages))).toEqual(['X@1 [Part@null [Z@1]]']);
  });

  test('entries without a destination survive only with surviving children', () => {
    const { pages } = fourPages();
    const nodes = [node('Part', null, null, [node('P1', 1)]), node('Loose', null, null), node('Gone', null, null, [node('G1', 7)])];
    const out = remapOutline([{ src: 0, nodes }], pages);
    expect(show(out)).toEqual(['Part@null [P1@1]']);
  });

  test('uses the first position of a page that appears twice', () => {
    const { pages, next } = fourPages();
    const dup = insertPages(pages, 0, [{ src: 0, index: 2 }], next).pages; // 2',0,1,2,3
    expect(show(remapOutline([{ src: 0, nodes: [node('B1', 2)] }], dup))).toEqual(['B1@0']);
  });

  test('orders sources by the position of their first page', () => {
    const { pages, next } = fourPages();
    const merged = insertPages(pages, 0, [{ src: 1, index: 0 }, { src: 1, index: 1 }], next).pages;
    const outline1: SourceOutline = { src: 1, nodes: [node('One', 0), node('Two', 1)] };
    const out = remapOutline([outline0, outline1], merged);
    expect(show(out)).toEqual(['One@0', 'Two@1', 'A@2', 'B@3 [B1@4, B2@5]', 'C@5']);
  });

  test('sources without pages contribute nothing', () => {
    const { pages } = fourPages();
    const orphan: SourceOutline = { src: 3, nodes: [node('Orphan', 0)] };
    expect(show(remapOutline([orphan, outline0], pages))).toEqual(['A@0', 'B@1 [B1@2, B2@3]', 'C@3']);
  });

  test('does not mutate the source outlines', () => {
    const { pages } = fourPages();
    const before = structuredClone(outline0);
    remapOutline([outline0], movePages(pages, new Set([1]), 4));
    expect(outline0).toEqual(before);
  });
});
