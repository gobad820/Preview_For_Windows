import { describe, expect, it } from 'vitest';
import { quadsForRects, quadsInTextFrame } from '../../src/markup/textMarkup';

const r = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

describe('quadsForRects', () => {
  it('merges the word rects of one line into one quad (top-left, top-right, bottom-left, bottom-right)', () => {
    const quads = quadsForRects([r(72, 700, 100, 712), r(101.5, 700, 140, 712), r(141, 700.5, 180, 711.5)]);
    expect(quads).toEqual([[72, 712, 180, 712, 72, 700, 180, 700]]);
  });

  it('keeps two lines as two quads, the upper line first', () => {
    const quads = quadsForRects([r(72, 680, 150, 692), r(72, 700, 200, 712), r(152, 680, 190, 692)]);
    expect(quads).toEqual([
      [72, 712, 200, 712, 72, 700, 200, 700],
      [72, 692, 190, 692, 72, 680, 190, 680],
    ]);
  });

  it('merges rects that touch or overlap within 2 pt, not ones further apart', () => {
    expect(quadsForRects([r(0, 0, 10, 10), r(12, 0, 20, 10)])).toHaveLength(1);
    expect(quadsForRects([r(0, 0, 10, 10), r(5, 0, 20, 10)])).toHaveLength(1);
    expect(quadsForRects([r(0, 0, 10, 10), r(12.5, 0, 20, 10)])).toHaveLength(2);
  });

  it('needs a vertical overlap of half the smaller height', () => {
    expect(quadsForRects([r(0, 0, 10, 10), r(10, 5, 20, 15)])).toHaveLength(1);
    expect(quadsForRects([r(0, 0, 10, 10), r(10, 5.5, 20, 15.5)])).toHaveLength(2);
    // A small superscript inside a tall line still joins it.
    expect(quadsForRects([r(0, 0, 10, 12), r(10, 7, 14, 11)])).toHaveLength(1);
  });

  it('merges chains whose ends only meet through the middle rect, and duplicates', () => {
    const quads = quadsForRects([r(0, 0, 10, 10), r(30, 0, 40, 10), r(9, 0, 31, 10), r(9, 0, 31, 10)]);
    expect(quads).toEqual([[0, 10, 40, 10, 0, 0, 40, 0]]);
  });

  it('ignores empty input and degenerate rects', () => {
    expect(quadsForRects([])).toEqual([]);
    expect(quadsForRects([r(5, 5, 5, 20), r(0, 3, 9, 3)])).toEqual([]);
  });
});

describe('quadsInTextFrame', () => {
  it('is quadsForRects for upright text', () => {
    const rects = [r(72, 700, 100, 712), r(101, 700, 140, 712)];
    expect(quadsInTextFrame(rects, 0)).toEqual(quadsForRects(rects));
  });

  it('merges along the text direction and puts the quad top on the text top for turned text', () => {
    // Text turned 90° counter-clockwise: it runs up the page (+y) and its top faces -x.
    const quads = quadsInTextFrame([r(100, 100, 112, 140), r(100, 141, 112, 180)], 90);
    expect(quads).toEqual([[100, 100, 100, 180, 112, 100, 112, 180]]);
    // Upside-down text runs to -x with its top facing -y.
    const flipped = quadsInTextFrame([r(100, 100, 140, 112), r(141, 100, 180, 112)], 180);
    expect(flipped).toEqual([[180, 100, 100, 100, 180, 112, 100, 112]]);
    // Turned 270°: runs down the page (-y), top faces +x.
    const down = quadsInTextFrame([r(100, 100, 112, 140), r(100, 141, 112, 180)], 270);
    expect(down).toEqual([[112, 180, 112, 100, 100, 180, 100, 100]]);
  });
});
