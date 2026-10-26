import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLES, MarkupState, STORAGE_KEY } from '../../src/markup/state';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('MarkupState', () => {
  it('starts with the Text Selection tool, highlight mode off and the default styles', () => {
    const s = new MarkupState(memoryStorage());
    expect(s.tool).toBe('select');
    expect(s.highlightMode).toBe(false);
    expect(s.styles).toEqual(DEFAULT_STYLES);
    expect(DEFAULT_STYLES).toMatchObject({ fill: null, width: 2, textColor: '#000000', fontSize: 12, markKind: 'highlight' });
    expect(s.markColorFor('underline')).toBe(s.markColorFor('strikeout'));
    expect(s.markColorFor('underline')).not.toBe(s.markColorFor('highlight'));
  });

  it('persists styles and reloads them in a new instance', () => {
    const storage = memoryStorage();
    const a = new MarkupState(storage);
    a.setStyles({ stroke: '#007aff', fill: '#34c759', width: 5, textColor: '#ff3b30', fontSize: 24 });
    a.setMark('strikeout', '#af52de');
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    const b = new MarkupState(storage);
    expect(b.styles).toEqual({
      stroke: '#007aff',
      fill: '#34c759',
      width: 5,
      textColor: '#ff3b30',
      fontSize: 24,
      markColor: '#af52de',
      markKind: 'strikeout',
    });
    expect(b.markColorFor('highlight')).toBe(DEFAULT_STYLES.markColor);
  });

  it('falls back to defaults for garbage or partly invalid storage', () => {
    expect(new MarkupState(memoryStorage({ [STORAGE_KEY]: '{not json' })).styles).toEqual(DEFAULT_STYLES);
    expect(new MarkupState(memoryStorage({ [STORAGE_KEY]: '42' })).styles).toEqual(DEFAULT_STYLES);
    const partly = new MarkupState(
      memoryStorage({
        [STORAGE_KEY]: JSON.stringify({ stroke: 'red', fill: '#00ff00', width: -3, fontSize: 900, textColor: 7, markKind: 'squiggly' }),
      }),
    );
    expect(partly.styles).toEqual({ ...DEFAULT_STYLES, fill: '#00ff00' });
  });

  it('works without storage (private mode, tests)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = new MarkupState(throwing);
    expect(s.styles).toEqual(DEFAULT_STYLES);
    expect(() => s.setStyles({ width: 3 })).not.toThrow();
    expect(s.styles.width).toBe(3);
    expect(new MarkupState(null).styles).toEqual(DEFAULT_STYLES);
  });

  it('keeps one color per mark kind', () => {
    const s = new MarkupState(memoryStorage());
    const yellow = s.styles.markColor;
    s.setMark('highlight', '#8ee07a');
    s.setMark('underline');
    expect(s.styles.markKind).toBe('underline');
    expect(s.styles.markColor).toBe(s.markColorFor('underline'));
    expect(s.markColorFor('highlight')).toBe('#8ee07a');
    s.setMark('underline', '#007aff');
    s.setMark('highlight');
    expect(s.styles.markColor).toBe('#8ee07a');
    expect(s.markColorFor('underline')).toBe('#007aff');
    expect(yellow).not.toBe('#8ee07a');
  });

  it('notifies listeners only on effective changes and stops after unsubscribing', () => {
    const s = new MarkupState(memoryStorage());
    const cb = vi.fn();
    const off = s.onChange(cb);
    s.setTool('rect');
    s.setTool('rect');
    s.setHighlightMode(true);
    s.setStyles({ width: 2 });
    s.setStyles({ width: 3 });
    expect(cb).toHaveBeenCalledTimes(3);
    expect(s.tool).toBe('rect');
    expect(s.highlightMode).toBe(true);
    off();
    s.setTool('select');
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid style values passed at runtime', () => {
    const s = new MarkupState(memoryStorage());
    s.setStyles({ stroke: 'blue', width: Number.NaN, fontSize: 4 });
    expect(s.styles).toEqual(DEFAULT_STYLES);
    s.setStyles({ fontSize: 72, fill: null });
    expect(s.styles.fontSize).toBe(72);
  });
});
