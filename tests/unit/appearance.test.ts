import { describe, expect, it } from 'vitest';
import { buildAppearance, hexToRgb, wrapText, type AppearanceFont } from '../../src/annot/appearance';
import { annotBounds, arrowHead } from '../../src/annot/geometry';
import type { Annot, InkAnnot, LineAnnot, MarkupAnnot, NoteAnnot, ShapeAnnot, TextBoxAnnot } from '../../src/annot/types';

const base = { color: '#ff0000', opacity: 1, modified: '2026-10-26T00:00:00.000Z' };

/** Every character is half an em wide; encodes ASCII and Hangul. */
const font: AppearanceFont = {
  name: 'F1',
  encode: (t) => `<${Array.from(t, (c) => c.codePointAt(0)!.toString(16).padStart(4, '0')).join('')}>`,
  widthOf: (t, size) => Array.from(t).length * size * 0.5,
  ascent: 0.8,
  descent: -0.2,
};

const quad = (x0: number, y0: number, x1: number, y1: number) => [x0, y1, x1, y1, x0, y0, x1, y0] as const;

const mark = (kind: MarkupAnnot['kind']): MarkupAnnot => ({
  ...base,
  id: kind,
  kind,
  quads: [quad(10, 16, 110, 30), quad(10, 0, 60, 14)],
  text: 'two lines',
});

const shape = (over: Partial<ShapeAnnot> = {}): ShapeAnnot => ({
  ...base,
  id: 's',
  kind: 'rect',
  rect: { x0: 10, y0: 10, x1: 110, y1: 60 },
  fill: null,
  width: 2,
  rounded: false,
  ...over,
});

const textBox = (over: Partial<TextBoxAnnot> = {}): TextBoxAnnot => ({
  ...base,
  color: '#000000',
  id: 't',
  kind: 'text',
  rect: { x0: 100, y0: 100, x1: 160, y1: 140 },
  text: 'aaa bbb ccc ddd',
  fontSize: 10,
  fill: null,
  border: null,
  borderWidth: 1,
  angle: 0,
  ...over,
});

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('hexToRgb', () => {
  it('converts to 0–1 components', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });
});

describe('text markup', () => {
  it('highlights fill every quad through a multiply graphics state', () => {
    const ap = buildAppearance(mark('highlight'), null)!;
    expect(ap.extGState).toEqual({ opacity: 1, multiply: true });
    expect(ap.content).toContain('/GS0 gs');
    expect(ap.content).toContain('1 0 0 rg');
    expect(count(ap.content, / m /g)).toBe(2);
    expect(count(ap.content, /\bf\b/g)).toBe(2);
    expect(ap.rect).toEqual(annotBounds(mark('highlight')));
    expect(ap.usesFont).toBe(false);
  });

  it('underlines where the overlay does: 10% of the line height above the bottom, 7.5% thick', () => {
    const ap = buildAppearance(mark('underline'), null)!;
    expect(ap.content).toContain('1.05 w 10 17.4 m 110 17.4 l S');
    expect(ap.content).toContain('1.05 w 10 1.4 m 60 1.4 l S');
  });

  it('strikes through at 45% of the line height', () => {
    expect(buildAppearance(mark('strikeout'), null)!.content).toContain('10 22.3 m 110 22.3 l S');
  });
});

describe('shapes, lines and ink', () => {
  it('strokes a rectangle and fills it when it has a fill', () => {
    const plain = buildAppearance(shape(), null)!;
    expect(plain.content).toMatch(/10 10 100 50 re\s+S/);
    expect(plain.content).toContain('1 J 1 j 2 w');
    const filled = buildAppearance(shape({ fill: '#00ff00' }), null)!;
    expect(filled.content).toContain('0 1 0 rg');
    expect(filled.content).toMatch(/re\s+B/);
  });

  it('draws rounded rectangles and ovals with curves', () => {
    expect(count(buildAppearance(shape({ rounded: true }), null)!.content, / c\b/g)).toBe(4);
    expect(count(buildAppearance(shape({ kind: 'oval' }), null)!.content, / c\b/g)).toBe(4);
  });

  it('uses a graphics state only for translucent shapes', () => {
    expect(buildAppearance(shape(), null)!.extGState).toBeUndefined();
    expect(buildAppearance(shape({ opacity: 0.5 }), null)!.extGState).toEqual({ opacity: 0.5, multiply: false });
  });

  it('draws the arrowhead at the end of an arrow', () => {
    const arrow: LineAnnot = { ...base, id: 'a', kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, width: 2 };
    const ap = buildAppearance(arrow, null)!;
    const [w1, w2] = arrowHead(arrow.from, arrow.to, 2)!;
    const n = (v: number) => String(Math.round(v * 1000) / 1000);
    expect(ap.content).toContain('0 0 m 100 0 l S');
    expect(ap.content).toContain(`${n(w1.x)} ${n(w1.y)} m 100 0 l ${n(w2.x)} ${n(w2.y)} l S`);
    const line: LineAnnot = { ...arrow, kind: 'line' };
    expect(count(buildAppearance(line, null)!.content, / m /g)).toBe(1);
  });

  it('draws ink paths as polylines with round caps and joins, like the overlay', () => {
    const ink: InkAnnot = {
      ...base,
      id: 'i',
      kind: 'ink',
      paths: [[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }]],
      width: 3,
    };
    const ap = buildAppearance(ink, null)!;
    expect(ap.content).toContain('1 J 1 j');
    expect(ap.content).toContain('0 0 m 10 10 l 20 0 l 30 10 l S');
  });

  it('uses the annotation bounds as /Rect for every kind', () => {
    const all: Annot[] = [
      mark('highlight'),
      shape(),
      shape({ kind: 'oval', width: 6 }),
      { ...base, id: 'a', kind: 'arrow', from: { x: 5, y: 5 }, to: { x: 80, y: 40 }, width: 3 },
      textBox(),
      { ...base, id: 'n', kind: 'note', rect: { x0: 0, y0: 0, x1: 20, y1: 20 }, text: 'hi', angle: 0 },
    ];
    for (const a of all) expect(buildAppearance(a, font)!.rect).toEqual(annotBounds(a));
  });
});

describe('text boxes', () => {
  it('wraps at spaces and keeps Hangul words whole (CSS word-break: keep-all)', () => {
    expect(wrapText('aaa bbb ccc ddd', 56, 10, font)).toEqual(['aaa bbb ccc', 'ddd']);
    expect(wrapText('가나다 라마바사', 26, 10, font)).toEqual(['가나다', '라마바사']);
    expect(wrapText('가나다라마바사아자차카타', 56, 10, font)).toEqual(['가나다라마바사아자차카', '타']);
    expect(wrapText('one\n\ntwo', 56, 10, font)).toEqual(['one', '', 'two']);
    expect(wrapText('abcdefghijklmnop', 56, 10, font)).toEqual(['abcdefghijk', 'lmnop']);
  });

  it('sets text in the font, clipped to the box, below the padding', () => {
    const ap = buildAppearance(textBox(), font)!;
    expect(ap.usesFont).toBe(true);
    expect(ap.content).toContain('/F1 10 Tf');
    expect(ap.content).toContain('100 100 60 40 re W n');
    expect(count(ap.content, /Tj/g)).toBe(2);
    expect(ap.content).toContain(font.encode('ddd')!);
  });

  it('draws fill and border when set', () => {
    const ap = buildAppearance(textBox({ fill: '#ffff00', border: '#0000ff', borderWidth: 2 }), font)!;
    expect(ap.content).toContain('1 1 0 rg');
    expect(ap.content).toContain('0 0 1 RG');
  });

  it('rotates the text frame by the stored angle', () => {
    const ap = buildAppearance(textBox({ angle: 90, rect: { x0: 100, y0: 100, x1: 140, y1: 160 } }), font)!;
    // Baseline runs up the page; the frame origin is the box's top-left as the text reads.
    expect(ap.content).toContain('0 1 -1 0 100 100 cm');
  });

  it('draws only the box, without text, when no font can show the text', () => {
    for (const f of [null, { ...font, encode: () => null }]) {
      const ap = buildAppearance(textBox({ fill: '#ffff00' }), f);
      expect(ap.usesFont).toBe(false);
      expect(ap.content).not.toContain('Tj');
      expect(ap.content).toContain('1 1 0 rg');
      expect(ap.rect).toEqual({ x0: 100, y0: 100, x1: 160, y1: 140 });
    }
  });
});

describe('notes', () => {
  it('draws an icon in the note box', () => {
    const note: NoteAnnot = { ...base, color: '#ffd60a', id: 'n', kind: 'note', rect: { x0: 0, y0: 0, x1: 20, y1: 20 }, text: 'hi', angle: 0 };
    const ap = buildAppearance(note, null)!;
    expect(ap.content.length).toBeGreaterThan(20);
    expect(ap.rect).toEqual(note.rect);
    expect(ap.usesFont).toBe(false);
  });
});
