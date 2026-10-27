/**
 * The markup toolbar row (Preview's Markup toolbar): tools, the highlight split button and
 * the style controls. It only reads and sets `MarkupState`; what a style change does to the
 * selected annotation is up to `actions.applyStyles`.
 */
import { t, type MessageKey } from '../i18n';
import type { Store, ViewerState } from '../store';
import { icons } from '../ui/icons';
import { i18n, localize } from '../ui/localize';
import { showMenu, type MenuItem } from '../ui/menu';
import { colorGrid, showPopover } from './popover';
import {
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  LINE_WIDTHS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type MarkKind,
  type MarkupState,
  type Styles,
  type Tool,
} from './state';
import type { Color } from '../annot/types';

export interface MarkupBarActions {
  /** The highlight button's main part. */
  highlight(): void;
  /** A highlight color or kind was picked from a highlight menu. */
  pickMark(kind: MarkKind, color?: Color): void;
  /** A style control changed: becomes the default and restyles the selection. */
  applyStyles(patch: Partial<Styles>): void;
}

type ShapeTool = 'line' | 'arrow' | 'rect' | 'rounded' | 'oval';

const SHAPES: ReadonlyArray<{ tool: ShapeTool; label: MessageKey; icon: string }> = [
  { tool: 'line', label: 'chrome.mk.line', icon: icons.shapeLine },
  { tool: 'arrow', label: 'chrome.mk.arrow', icon: icons.shapeArrow },
  { tool: 'rect', label: 'chrome.mk.rect', icon: icons.shapeRect },
  { tool: 'rounded', label: 'chrome.mk.rounded', icon: icons.shapeRounded },
  { tool: 'oval', label: 'chrome.mk.oval', icon: icons.shapeOval },
];

const isShape = (t: Tool): t is ShapeTool => SHAPES.some((s) => s.tool === t);

const swatchIcon = (color: Color) => `<span class="menu-swatch" style="--swatch: ${color}"></span>`;
const markIcon = (kind: 'underline' | 'strikeout', color: Color) =>
  `<span class="menu-mark" data-kind="${kind}" style="--swatch: ${color}">S</span>`;

/** Items for a highlight chevron menu (toolbar or markup bar). */
export function highlightMenuItems(state: MarkupState, pick: (kind: MarkKind, color?: Color) => void): MenuItem[] {
  const { markKind, markColor } = state.styles;
  return [
    ...HIGHLIGHT_COLORS.map(
      ({ name, color }): MenuItem => ({
        label: name,
        icon: swatchIcon(color),
        radio: true,
        checked: markKind === 'highlight' && markColor === color,
        action: () => pick('highlight', color),
      }),
    ),
    'separator',
    {
      label: t('chrome.mk.underline'),
      icon: markIcon('underline', state.markColorFor('underline')),
      radio: true,
      checked: markKind === 'underline',
      action: () => pick('underline'),
    },
    {
      label: t('chrome.mk.strikethrough'),
      icon: markIcon('strikeout', state.markColorFor('strikeout')),
      radio: true,
      checked: markKind === 'strikeout',
      action: () => pick('strikeout'),
    },
  ];
}

/** Opens a highlight menu below `anchor`, marking `button` expanded while it shows. */
export function openHighlightMenu(
  anchor: DOMRect,
  button: HTMLElement | null,
  state: MarkupState,
  pick: (kind: MarkKind, color?: Color) => void,
): void {
  button?.setAttribute('aria-expanded', 'true');
  void showMenu(anchor, highlightMenuItems(state, pick)).then(() => button?.setAttribute('aria-expanded', 'false'));
}

/** A button's tooltip and accessible name: one message. */
const named = (key: MessageKey) => i18n({ title: key, label: key });

const template = `
  <button class="tb-btn mk-btn" data-markup="select" ${named('chrome.mk.select')} aria-pressed="true">${icons.textCursor}</button>
  <button class="tb-btn mk-btn" data-markup="draw" ${named('chrome.mk.draw')} aria-pressed="false">${icons.pencil}</button>
  <button class="tb-btn mk-btn mk-menu" data-markup="shapes" ${named('chrome.mk.shapes')} aria-haspopup="menu" aria-expanded="false" aria-pressed="false"><span class="mk-glyph">${icons.shapes}</span>${icons.chevronDown}</button>
  <button class="tb-btn mk-btn" data-markup="text" ${named('chrome.mk.text')} aria-pressed="false">${icons.textBox}</button>
  <button class="tb-btn mk-btn" data-markup="note" ${named('chrome.mk.note')} aria-pressed="false">${icons.note}</button>
  <span class="mk-sep" data-markup="separator" role="separator"></span>
  <div class="tb-split" role="group" ${i18n({ label: 'chrome.mk.highlight' })}>
    <button class="tb-btn tb-split-main" data-markup="highlight" ${named('chrome.mk.highlight')} aria-pressed="false">${icons.highlighter}<span class="tb-swatch" data-highlight-swatch></span></button>
    <button class="tb-btn tb-split-menu" data-markup="highlight-menu" ${i18n({ title: 'chrome.mk.highlightStyle', label: 'chrome.mk.highlightStyleLabel' })} aria-haspopup="menu" aria-expanded="false">${icons.chevronDown}</button>
  </div>
  <span class="mk-sep" data-markup="separator" role="separator"></span>
  <button class="tb-btn mk-btn mk-menu" data-markup="width" ${named('chrome.mk.lineWidth')} aria-haspopup="menu" aria-expanded="false">${icons.lineWidth}${icons.chevronDown}</button>
  <button class="tb-btn mk-btn mk-menu" data-markup="stroke" ${named('chrome.mk.borderColor')} aria-haspopup="dialog" aria-expanded="false">${icons.borderColor}${icons.chevronDown}</button>
  <button class="tb-btn mk-btn mk-menu" data-markup="fill" ${named('chrome.mk.fillColor')} aria-haspopup="dialog" aria-expanded="false">${icons.fillColor}${icons.chevronDown}</button>
  <button class="tb-btn mk-btn mk-menu" data-markup="text-style" ${named('chrome.mk.textStyle')} aria-haspopup="dialog" aria-expanded="false">${icons.textStyle}${icons.chevronDown}</button>
`;

export class MarkupBar {
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly state: MarkupState,
    private readonly actions: MarkupBarActions,
    store: Store<ViewerState>,
  ) {
    host.innerHTML = template;
    host.setAttribute('role', 'toolbar');
    host.dataset['i18nLabel'] = 'chrome.mk.toolbar' satisfies MessageKey;
    const on = (name: string, fn: (b: HTMLElement) => void) => {
      const b = this.q(name);
      b.addEventListener('click', () => fn(b));
    };
    on('select', () => state.setTool('select'));
    on('draw', () => state.setTool(state.tool === 'draw' ? 'select' : 'draw'));
    on('text', () => state.setTool('text'));
    on('note', () => state.setTool('note'));
    on('shapes', (b) => this.shapesMenu(b));
    on('highlight', () => actions.highlight());
    on('highlight-menu', (b) =>
      openHighlightMenu(b.closest('.tb-split')!.getBoundingClientRect(), b, state, (kind, color) => actions.pickMark(kind, color)),
    );
    on('width', (b) => this.widthMenu(b));
    on('stroke', (b) => this.strokePopover(b));
    on('fill', (b) => this.fillPopover(b));
    on('text-style', (b) => this.textStylePopover(b));
    this.unsubscribe.push(
      state.onChange(() => this.sync()),
      store.select('locale', () => localize(host)),
    );
    this.sync();
  }

  destroy(): void {
    for (const u of this.unsubscribe) u();
    this.host.innerHTML = '';
  }

  // ---- internals ------------------------------------------------------------

  private q(name: string): HTMLElement {
    const el = this.host.querySelector<HTMLElement>(`[data-markup="${name}"]`);
    if (!el) throw new Error(`markup bar: missing ${name}`);
    return el;
  }

  private sync(): void {
    const { tool, highlightMode, styles } = this.state;
    const pressed = (name: string, on: boolean) => this.q(name).setAttribute('aria-pressed', String(on));
    pressed('select', tool === 'select');
    pressed('draw', tool === 'draw');
    pressed('shapes', isShape(tool));
    pressed('text', tool === 'text');
    pressed('note', tool === 'note');
    pressed('highlight', highlightMode);
    const shape = SHAPES.find((s) => s.tool === tool);
    const glyph = this.q('shapes').querySelector<HTMLElement>('.mk-glyph')!;
    const icon = shape?.icon ?? icons.shapes;
    if (glyph.innerHTML !== icon) glyph.innerHTML = icon;
    const swatch = this.host.querySelector<HTMLElement>('[data-highlight-swatch]')!;
    swatch.style.setProperty('--swatch', styles.markColor);
    swatch.dataset['kind'] = styles.markKind;
    this.q('stroke').style.setProperty('--swatch', styles.stroke);
    const fill = this.q('fill');
    if (styles.fill) fill.style.setProperty('--swatch', styles.fill);
    else fill.style.removeProperty('--swatch');
    fill.toggleAttribute('data-nofill', styles.fill === null);
    this.q('text-style').style.setProperty('--swatch', styles.textColor);
  }

  private shapesMenu(button: HTMLElement): void {
    const tool = this.state.tool;
    button.setAttribute('aria-expanded', 'true');
    void showMenu(
      button.getBoundingClientRect(),
      SHAPES.map(
        (s): MenuItem => ({ label: t(s.label), icon: s.icon, radio: true, checked: tool === s.tool, action: () => this.state.setTool(s.tool) }),
      ),
    ).then(() => button.setAttribute('aria-expanded', 'false'));
  }

  private widthMenu(button: HTMLElement): void {
    const width = this.state.styles.width;
    button.setAttribute('aria-expanded', 'true');
    void showMenu(
      button.getBoundingClientRect(),
      LINE_WIDTHS.map(
        (w): MenuItem => ({
          label: t('chrome.mk.points', { n: w }),
          icon: `<span class="menu-width" style="--w: ${Math.max(0.5, Math.min(w, 6))}px"></span>`,
          radio: true,
          checked: width === w,
          action: () => this.actions.applyStyles({ width: w }),
        }),
      ),
    ).then(() => button.setAttribute('aria-expanded', 'false'));
  }

  private strokePopover(button: HTMLElement): void {
    void showPopover(
      button,
      (close) =>
        colorGrid(this.state.styles.stroke, (c) => {
          close();
          this.actions.applyStyles({ stroke: c });
        }),
      t('chrome.mk.borderColor'),
    );
  }

  private fillPopover(button: HTMLElement): void {
    void showPopover(
      button,
      (close) => {
        const wrap = document.createElement('div');
        const none = document.createElement('button');
        none.type = 'button';
        none.className = 'palette-row';
        none.dataset['noFill'] = '';
        none.setAttribute('aria-checked', String(this.state.styles.fill === null));
        none.innerHTML = `<span class="palette-nofill" aria-hidden="true"></span>`;
        none.append(t('chrome.mk.noFill'));
        none.addEventListener('click', () => {
          close();
          this.actions.applyStyles({ fill: null });
        });
        wrap.append(
          none,
          colorGrid(this.state.styles.fill, (c) => {
            close();
            this.actions.applyStyles({ fill: c });
          }),
        );
        return wrap;
      },
      t('chrome.mk.fillColor'),
    );
  }

  private textStylePopover(button: HTMLElement): void {
    void showPopover(
      button,
      () => {
        const wrap = document.createElement('div');
        const row = document.createElement('div');
        row.className = 'palette-size';
        const label = document.createElement('span');
        label.className = 'palette-size-label';
        label.textContent = t('chrome.mk.size');
        const value = document.createElement('span');
        value.className = 'palette-size-value';
        value.dataset['fontSize'] = '';
        const step = (dir: -1 | 1) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'palette-step';
          b.dataset['sizeStep'] = String(dir);
          b.setAttribute('aria-label', t(dir > 0 ? 'chrome.mk.bigger' : 'chrome.mk.smaller'));
          b.textContent = dir > 0 ? '+' : '−';
          b.addEventListener('click', () => {
            const next = nextFontSize(this.state.styles.fontSize, dir);
            this.actions.applyStyles({ fontSize: next });
            render();
          });
          return b;
        };
        const smaller = step(-1);
        const bigger = step(1);
        const render = () => {
          const size = this.state.styles.fontSize;
          value.textContent = t('chrome.mk.points', { n: size });
          smaller.disabled = size <= MIN_FONT_SIZE;
          bigger.disabled = size >= MAX_FONT_SIZE;
          for (const s of grid.querySelectorAll<HTMLElement>('[data-color]')) {
            s.setAttribute('aria-checked', String(s.dataset['color'] === this.state.styles.textColor));
          }
        };
        const grid = colorGrid(this.state.styles.textColor, (c) => {
          this.actions.applyStyles({ textColor: c });
          render();
        });
        row.append(label, smaller, value, bigger);
        wrap.append(row, grid);
        render();
        return wrap;
      },
      t('chrome.mk.textStyle'),
    );
  }
}

/** The next size in `FONT_SIZES` above or below `size`. */
export function nextFontSize(size: number, dir: -1 | 1): number {
  if (dir > 0) return FONT_SIZES.find((s) => s > size) ?? MAX_FONT_SIZE;
  return [...FONT_SIZES].reverse().find((s) => s < size) ?? MIN_FONT_SIZE;
}
