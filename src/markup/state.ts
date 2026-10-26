/**
 * Markup tool and style state for one window. Styles are the defaults for new annotations and
 * are remembered across launches (Preview's behaviour); the armed tool and highlight mode are not.
 */
import type { Color } from '../annot/types';

export type Tool = 'select' | 'draw' | 'line' | 'arrow' | 'rect' | 'rounded' | 'oval' | 'text' | 'note';
export type MarkKind = 'highlight' | 'underline' | 'strikeout';

export interface Styles {
  /** Shapes, lines, drawings and text box borders. */
  stroke: Color;
  /** Shape and text box fill; null = No Fill. */
  fill: Color | null;
  /** Stroke width in points. */
  width: number;
  textColor: Color;
  /** Text box font size in points. */
  fontSize: number;
  /** Color of the current mark kind (each kind keeps its own color). */
  markColor: Color;
  markKind: MarkKind;
}

export interface NamedColor {
  readonly name: string;
  readonly color: Color;
}

/** Highlight colors in Preview's order. Light enough to read through with multiply blending. */
export const HIGHLIGHT_COLORS: readonly NamedColor[] = [
  { name: 'Yellow', color: '#ffe14d' },
  { name: 'Green', color: '#8ee07a' },
  { name: 'Blue', color: '#8ac4ff' },
  { name: 'Pink', color: '#ff8fb6' },
  { name: 'Purple', color: '#c99bf0' },
];

/** Border, fill and text colors (two rows of six, like Preview's palette). */
export const PALETTE: readonly NamedColor[] = [
  { name: 'Black', color: '#000000' },
  { name: 'Gray', color: '#8e8e93' },
  { name: 'White', color: '#ffffff' },
  { name: 'Brown', color: '#a2845e' },
  { name: 'Red', color: '#ff3b30' },
  { name: 'Orange', color: '#ff9500' },
  { name: 'Yellow', color: '#ffcc00' },
  { name: 'Green', color: '#34c759' },
  { name: 'Teal', color: '#30b0c7' },
  { name: 'Blue', color: '#007aff' },
  { name: 'Purple', color: '#af52de' },
  { name: 'Pink', color: '#ff2d55' },
];

export const LINE_WIDTHS: readonly number[] = [0.5, 1, 2, 3, 5, 8];
export const FONT_SIZES: readonly number[] = [9, 10, 11, 12, 14, 18, 24, 36, 48, 64, 72];
export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 72;
/** Sticky notes are always this color (Preview's default note color). */
export const NOTE_COLOR: Color = '#ffd60a';

export const STORAGE_KEY = 'pfw.markup';

const RED: Color = '#ff3b30';
const DEFAULT_MARK_COLORS: Readonly<Record<MarkKind, Color>> = {
  highlight: HIGHLIGHT_COLORS[0]!.color,
  underline: RED,
  strikeout: RED,
};

export const DEFAULT_STYLES: Readonly<Styles> = Object.freeze({
  stroke: RED,
  fill: null,
  width: 2,
  textColor: '#000000',
  fontSize: 12,
  markColor: DEFAULT_MARK_COLORS.highlight,
  markKind: 'highlight',
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const MARK_KINDS: readonly MarkKind[] = ['highlight', 'underline', 'strikeout'];
const isColor = (v: unknown): v is Color => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isWidth = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 72;
const isFontSize = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_FONT_SIZE && v <= MAX_FONT_SIZE;
const isMarkKind = (v: unknown): v is MarkKind => typeof v === 'string' && (MARK_KINDS as readonly string[]).includes(v);

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

interface Persisted {
  stroke: Color;
  fill: Color | null;
  width: number;
  textColor: Color;
  fontSize: number;
  markKind: MarkKind;
  markColors: Record<MarkKind, Color>;
}

export class MarkupState {
  private currentTool: Tool = 'select';
  private highlight = false;
  private data: Persisted;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: StorageLike | null = defaultStorage()) {
    this.data = this.load();
  }

  get tool(): Tool {
    return this.currentTool;
  }

  get highlightMode(): boolean {
    return this.highlight;
  }

  get styles(): Styles {
    const d = this.data;
    return {
      stroke: d.stroke,
      fill: d.fill,
      width: d.width,
      textColor: d.textColor,
      fontSize: d.fontSize,
      markColor: d.markColors[d.markKind],
      markKind: d.markKind,
    };
  }

  /** The color new marks of `kind` get. */
  markColorFor(kind: MarkKind): Color {
    return this.data.markColors[kind];
  }

  setTool(t: Tool): void {
    if (t === this.currentTool) return;
    this.currentTool = t;
    this.emit();
  }

  setHighlightMode(on: boolean): void {
    if (on === this.highlight) return;
    this.highlight = on;
    this.emit();
  }

  /** Makes `kind` the current mark style; `color` (when valid) becomes that kind's color. */
  setMark(kind: MarkKind, color?: Color): void {
    if (!isMarkKind(kind)) return;
    const colors = isColor(color) ? { ...this.data.markColors, [kind]: color.toLowerCase() } : this.data.markColors;
    if (kind === this.data.markKind && colors === this.data.markColors) return;
    this.update({ ...this.data, markKind: kind, markColors: colors });
  }

  /** Changes the defaults; invalid values are ignored. Persists. */
  setStyles(patch: Partial<Styles>): void {
    const next: Persisted = { ...this.data };
    if (patch.stroke !== undefined && isColor(patch.stroke)) next.stroke = patch.stroke.toLowerCase();
    if (patch.fill === null) next.fill = null;
    else if (patch.fill !== undefined && isColor(patch.fill)) next.fill = patch.fill.toLowerCase();
    if (patch.width !== undefined && isWidth(patch.width)) next.width = patch.width;
    if (patch.textColor !== undefined && isColor(patch.textColor)) next.textColor = patch.textColor.toLowerCase();
    if (patch.fontSize !== undefined && isFontSize(patch.fontSize)) next.fontSize = patch.fontSize;
    if (patch.markKind !== undefined && isMarkKind(patch.markKind)) next.markKind = patch.markKind;
    if (patch.markColor !== undefined && isColor(patch.markColor)) {
      next.markColors = { ...next.markColors, [next.markKind]: patch.markColor.toLowerCase() };
    }
    this.update(next);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- internals ------------------------------------------------------------

  private update(next: Persisted): void {
    const prev = this.data;
    const same =
      prev.stroke === next.stroke &&
      prev.fill === next.fill &&
      prev.width === next.width &&
      prev.textColor === next.textColor &&
      prev.fontSize === next.fontSize &&
      prev.markKind === next.markKind &&
      MARK_KINDS.every((k) => prev.markColors[k] === next.markColors[k]);
    if (same) return;
    this.data = next;
    this.save();
    this.emit();
  }

  private load(): Persisted {
    const d: Persisted = {
      stroke: DEFAULT_STYLES.stroke,
      fill: DEFAULT_STYLES.fill,
      width: DEFAULT_STYLES.width,
      textColor: DEFAULT_STYLES.textColor,
      fontSize: DEFAULT_STYLES.fontSize,
      markKind: DEFAULT_STYLES.markKind,
      markColors: { ...DEFAULT_MARK_COLORS },
    };
    let raw: unknown = null;
    try {
      const text = this.storage?.getItem(STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') return d;
    const r = raw as Record<string, unknown>;
    if (isColor(r['stroke'])) d.stroke = r['stroke'].toLowerCase();
    if (r['fill'] === null) d.fill = null;
    else if (isColor(r['fill'])) d.fill = r['fill'].toLowerCase();
    if (isWidth(r['width'])) d.width = r['width'];
    if (isColor(r['textColor'])) d.textColor = r['textColor'].toLowerCase();
    if (isFontSize(r['fontSize'])) d.fontSize = r['fontSize'];
    if (isMarkKind(r['markKind'])) d.markKind = r['markKind'];
    const colors = r['markColors'];
    if (colors && typeof colors === 'object') {
      for (const k of MARK_KINDS) {
        const c = (colors as Record<string, unknown>)[k];
        if (isColor(c)) d.markColors[k] = c.toLowerCase();
      }
    }
    return d;
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: the styles still apply for this session.
    }
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }
}
