import type { Annot } from '../../src/annot/types';

export const base = { opacity: 1, modified: '2026-10-26T01:02:03.000Z' };

/** One annotation of every kind, placed on an A4 page. */
export function sample(): Annot[] {
  return [
    { ...base, id: 'hl', kind: 'highlight', color: '#ffd60a', quads: [[70, 760, 200, 760, 70, 745, 200, 745]], text: 'Hello' },
    { ...base, id: 'ul', kind: 'underline', color: '#ff3b30', quads: [[70, 740, 200, 740, 70, 725, 200, 725]], text: 'world' },
    { ...base, id: 'so', kind: 'strikeout', color: '#ff3b30', quads: [[70, 720, 200, 720, 70, 705, 200, 705]], text: 'page' },
    { ...base, id: 'rc', kind: 'rect', color: '#ff0000', rect: { x0: 100, y0: 500, x1: 250, y1: 600 }, fill: null, width: 3, rounded: false },
    { ...base, id: 'ov', kind: 'oval', color: '#0000ff', rect: { x0: 300, y0: 500, x1: 400, y1: 560 }, fill: '#00ff00', width: 2, rounded: false },
    { ...base, id: 'ln', kind: 'line', color: '#000000', from: { x: 100, y: 400 }, to: { x: 200, y: 450 }, width: 1 },
    { ...base, id: 'ar', kind: 'arrow', color: '#ff3b30', from: { x: 300, y: 400 }, to: { x: 450, y: 400 }, width: 2 },
    { ...base, id: 'ik', kind: 'ink', color: '#007aff', paths: [[{ x: 100, y: 300 }, { x: 120, y: 320 }, { x: 140, y: 300 }]], width: 2.5 },
    {
      ...base,
      id: 'tx',
      kind: 'text',
      color: '#000000',
      rect: { x0: 300, y0: 250, x1: 450, y1: 300 },
      text: 'Typed comment',
      fontSize: 12,
      fill: '#ffffcc',
      border: '#888888',
      borderWidth: 1,
      angle: 0,
    },
    { ...base, id: 'nt', kind: 'note', color: '#ffd60a', rect: { x0: 500, y0: 700, x1: 520, y1: 720 }, text: 'A note', angle: 0 },
  ];
}

