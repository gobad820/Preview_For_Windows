import { describe, expect, it } from 'vitest';
import {
  ARROW_LEN,
  annotBounds,
  hitTest,
  normRect,
  resizeAnnot,
  translateAnnot,
} from '../../src/annot/geometry';
import type { InkAnnot, LineAnnot, MarkupAnnot, NoteAnnot, ShapeAnnot, TextBoxAnnot } from '../../src/annot/types';

const base = { color: '#ff0000', opacity: 1, modified: '2026-10-26T00:00:00.000Z' };

const rect = (over: Partial<ShapeAnnot> = {}): ShapeAnnot => ({
  ...base,
  id: 'r',
  kind: 'rect',
  rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
  fill: null,
  width: 4,
  rounded: false,
  ...over,
});

const arrow: LineAnnot = { ...base, id: 'a', kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, width: 2 };

const highlight: MarkupAnnot = {
  ...base,
  id: 'h',
  kind: 'highlight',
  quads: [[10, 50, 90, 50, 10, 40, 90, 40]],
  text: 'hello',
};

describe('normRect', () => {
  it('orders the corners', () => {
    expect(normRect({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual({ x0: 1, y0: 2, x1: 5, y1: 9 });
  });
});

describe('annotBounds', () => {
  it('grows a stroked rectangle by half its width', () => {
    expect(annotBounds(rect())).toEqual({ x0: 8, y0: 18, x1: 112, y1: 72 });
  });

  it('covers the arrowhead', () => {
    const b = annotBounds(arrow);
    expect(b.y0).toBeLessThan(-2);
    expect(b.y1).toBeGreaterThan(2);
    expect(b.x1).toBeGreaterThanOrEqual(100 + 1);
    expect(ARROW_LEN(2)).toBe(6);
    expect(ARROW_LEN(4)).toBe(12);
  });

  it('is the quads for text markup and the rect for text boxes and notes', () => {
    expect(annotBounds(highlight)).toEqual({ x0: 10, y0: 40, x1: 90, y1: 50 });
    const note: NoteAnnot = { ...base, id: 'n', kind: 'note', rect: { x0: 1, y0: 2, x1: 21, y1: 22 }, text: '', angle: 0 };
    expect(annotBounds(note)).toEqual(note.rect);
  });
});

describe('translateAnnot', () => {
  it('moves every point and keeps the id', () => {
    const moved = translateAnnot(highlight, 5, -5);
    expect(moved.id).toBe('h');
    expect(moved.quads[0]).toEqual([15, 45, 95, 45, 15, 35, 95, 35]);
    const line = translateAnnot(arrow, 1, 2);
    expect(line.from).toEqual({ x: 1, y: 2 });
    expect(line.to).toEqual({ x: 101, y: 2 });
  });
});

describe('resizeAnnot', () => {
  it('maps ink points from one box to another', () => {
    const ink: InkAnnot = { ...base, id: 'i', kind: 'ink', paths: [[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 2 }]], width: 1 };
    const out = resizeAnnot(ink, { x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 0, y0: 0, x1: 20, y1: 40 });
    expect(out.paths[0]).toEqual([{ x: 0, y: 0 }, { x: 20, y: 40 }, { x: 10, y: 8 }]);
  });

  it('maps rectangles and text boxes, and only translates notes', () => {
    const r = resizeAnnot(rect(), { x0: 10, y0: 20, x1: 110, y1: 70 }, { x0: 0, y0: 0, x1: 50, y1: 25 });
    expect(r.rect).toEqual({ x0: 0, y0: 0, x1: 50, y1: 25 });
    const t: TextBoxAnnot = {
      ...base,
      id: 't',
      kind: 'text',
      rect: { x0: 0, y0: 0, x1: 100, y1: 20 },
      text: 'x',
      fontSize: 12,
      fill: null,
      border: null,
      borderWidth: 1,
      angle: 0,
    };
    expect(resizeAnnot(t, t.rect, { x0: 10, y0: 10, x1: 60, y1: 50 }).rect).toEqual({ x0: 10, y0: 10, x1: 60, y1: 50 });
    const note: NoteAnnot = { ...base, id: 'n', kind: 'note', rect: { x0: 0, y0: 0, x1: 20, y1: 20 }, text: '', angle: 0 };
    expect(resizeAnnot(note, note.rect, { x0: 5, y0: 5, x1: 100, y1: 100 }).rect).toEqual({ x0: 5, y0: 5, x1: 25, y1: 25 });
  });

  it('maps line ends', () => {
    const out = resizeAnnot(arrow, { x0: 0, y0: -1, x1: 100, y1: 1 }, { x0: 0, y0: -1, x1: 50, y1: 1 });
    expect(out.to).toEqual({ x: 50, y: 0 });
  });
});

describe('hitTest', () => {
  it('hits an unfilled rectangle only near its edge', () => {
    expect(hitTest(rect(), { x: 10.5, y: 45 }, 3)).toBe(true);
    expect(hitTest(rect(), { x: 60, y: 45 }, 3)).toBe(false);
    expect(hitTest(rect({ fill: '#00ff00' }), { x: 60, y: 45 }, 3)).toBe(true);
  });

  it('hits inside markup quads only', () => {
    expect(hitTest(highlight, { x: 50, y: 45 }, 0)).toBe(true);
    expect(hitTest(highlight, { x: 50, y: 60 }, 0)).toBe(false);
  });

  it('hits lines within the tolerance', () => {
    expect(hitTest(arrow, { x: 50, y: 2.5 }, 3)).toBe(true);
    expect(hitTest(arrow, { x: 50, y: 10 }, 3)).toBe(false);
  });

  it('hits an oval on its outline', () => {
    const oval = rect({ kind: 'oval', rect: { x0: 0, y0: 0, x1: 100, y1: 50 } });
    expect(hitTest(oval, { x: 50, y: 0.5 }, 3)).toBe(true);
    expect(hitTest(oval, { x: 50, y: 25 }, 3)).toBe(false);
    expect(hitTest(oval, { x: 2, y: 2 }, 3)).toBe(false);
  });
});
