/**
 * The Settings window, in the manner of a modern macOS app's Settings: the pane's name over a
 * toolbar of pane icons (the selected one tinted on a pressed fill), then a pane of right-aligned
 * labels, pop-up buttons and check boxes. It sits inside the app window and is modal: keys,
 * presses and focus stay in it until it closes (close button, Esc or Ctrl+W). Changes apply at once.
 */
import {
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  LINE_WIDTHS,
  PALETTE,
  type MarkupState,
  type NamedColor,
} from '../markup/state';
import { closeMenus } from '../ui/menu';
import { popupArrows, settingsIcons } from './icons';
import type { DefaultZoom, Settings, SettingsModel } from './settings';

export type PaneId = 'general' | 'markup' | 'window';

const PANES: ReadonlyArray<{ id: PaneId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'markup', label: 'Markup' },
  { id: 'window', label: 'Window' },
];

const ZOOM_CHOICES: ReadonlyArray<{ value: DefaultZoom; label: string }> = [
  { value: 'fit-width', label: 'Fit Width' },
  { value: 'fit-page', label: 'Fit Page' },
  { value: 'actual-size', label: 'Actual Size' },
];

interface Choice {
  value: string;
  label: string;
  /** Shown as a color swatch before the label. */
  swatch?: string;
}

const colorChoices = (colors: readonly NamedColor[]): Choice[] =>
  colors.map((c) => ({ value: c.color, label: c.name, swatch: c.color }));
const points = (values: readonly number[]): Choice[] => values.map((v) => ({ value: String(v), label: `${v} pt` }));

export interface SettingsWindowDeps {
  settings: SettingsModel;
  markup: MarkupState;
}

export class SettingsWindow {
  private scrim: HTMLElement | null = null;
  private pane: PaneId = 'general';
  /** Undoes everything `open` set up. */
  private teardown: (() => void) | null = null;

  constructor(private readonly deps: SettingsWindowDeps) {}

  get isOpen(): boolean {
    return this.scrim !== null;
  }

  /** Shows the window on the pane it was last left on; does nothing when it is already open. */
  open(): void {
    if (this.scrim) return;
    closeMenus();
    const previousFocus = document.activeElement;
    const { settings, markup } = this.deps;

    const scrim = document.createElement('div');
    scrim.className = 'settings-scrim';
    const win = document.createElement('section');
    win.className = 'settings-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-label', 'Settings');
    win.tabIndex = -1;

    // ---- title bar ----
    const titlebar = document.createElement('header');
    titlebar.className = 'settings-titlebar';
    const lights = document.createElement('div');
    lights.className = 'settings-lights';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'settings-light settings-close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    const dim = () => {
      const s = document.createElement('span');
      s.className = 'settings-light';
      s.setAttribute('aria-hidden', 'true');
      return s;
    };
    lights.append(close, dim(), dim());
    const title = document.createElement('h2');
    title.className = 'settings-title';
    titlebar.append(lights, title);

    // ---- toolbar ----
    const toolbar = document.createElement('div');
    toolbar.className = 'settings-toolbar';
    toolbar.setAttribute('role', 'tablist');
    toolbar.setAttribute('aria-label', 'Settings');
    const tabs = new Map<PaneId, HTMLButtonElement>();
    const panes = new Map<PaneId, HTMLElement>();
    for (const p of PANES) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'settings-tab';
      t.id = `settings-tab-${p.id}`;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-controls', `settings-pane-${p.id}`);
      t.innerHTML = `<span class="settings-tab-icon">${settingsIcons[p.id]}</span>`;
      const label = document.createElement('span');
      label.className = 'settings-tab-label';
      label.textContent = p.label;
      t.append(label);
      t.addEventListener('click', () => select(p.id));
      tabs.set(p.id, t);
      toolbar.append(t);
    }

    // ---- panes ----
    const sync: Array<(s: Settings) => void> = [];
    const set = (patch: Partial<Settings>) => settings.set(patch);

    const general = this.paneEl('general');
    general.append(
      this.row('Default zoom:', 'settings-zoom', (id) => {
        const el = this.popup(id, ZOOM_CHOICES, (v) => set({ defaultZoom: v as DefaultZoom }));
        sync.push((s) => this.setPopup(el, s.defaultZoom));
        return el;
      }, 'For files opened for the first time.'),
      this.row('Page layout:', 'settings-layout', (id) => {
        const el = this.popup(
          id,
          [
            { value: 'continuous', label: 'Continuous Scroll' },
            { value: 'two-pages', label: 'Two Pages' },
          ],
          (v) => set({ displayMode: v === 'two-pages' ? 'two-pages' : 'continuous' }),
        );
        sync.push((s) => this.setPopup(el, s.displayMode));
        return el;
      }),
      this.checkRow('', 'Book Mode', 'The first page sits alone on the right, like a cover.', (box) => {
        box.addEventListener('change', () => set({ bookMode: box.checked }));
        sync.push((s) => {
          box.checked = s.bookMode;
          box.disabled = s.displayMode !== 'two-pages';
        });
      }),
      this.checkRow('Sidebar:', 'Show the sidebar when a document opens', null, (box) => {
        box.addEventListener('change', () => set({ sidebarOnOpen: box.checked }));
        sync.push((s) => (box.checked = s.sidebarOnOpen));
      }),
      this.checkRow(
        'Documents:',
        "Remember each file's last page and zoom",
        'Turning this off forgets the positions remembered so far.',
        (box) => {
          box.addEventListener('change', () => set({ rememberPosition: box.checked }));
          sync.push((s) => (box.checked = s.rememberPosition));
        },
      ),
    );

    const markupPane = this.paneEl('markup');
    const markupSync: Array<() => void> = [];
    markupPane.append(
      this.row('Highlight color:', 'settings-highlight', (id) => {
        const el = this.popup(id, colorChoices(HIGHLIGHT_COLORS), (v) => markup.setMarkColor('highlight', v));
        markupSync.push(() => this.setPopup(el, markup.markColorFor('highlight'), { label: 'Custom', swatch: true }));
        return el;
      }),
      this.row('Shape color:', 'settings-stroke', (id) => {
        const el = this.popup(id, colorChoices(PALETTE), (v) => markup.setStyles({ stroke: v }));
        markupSync.push(() => this.setPopup(el, markup.styles.stroke, { label: 'Custom', swatch: true }));
        return el;
      }, 'Borders of shapes, lines and drawings.'),
      this.row('Line width:', 'settings-width', (id) => {
        const el = this.popup(id, points(LINE_WIDTHS), (v) => markup.setStyles({ width: Number(v) }));
        markupSync.push(() => this.setPopup(el, String(markup.styles.width), { label: `${markup.styles.width} pt` }));
        return el;
      }),
      this.row('Text size:', 'settings-font-size', (id) => {
        const el = this.popup(id, points(FONT_SIZES), (v) => markup.setStyles({ fontSize: Number(v) }));
        markupSync.push(() => this.setPopup(el, String(markup.styles.fontSize), { label: `${markup.styles.fontSize} pt` }));
        return el;
      }, 'For new text boxes.'),
    );

    const windowPane = this.paneEl('window');
    windowPane.append(
      this.checkRow('Menu bar:', 'Show the menu bar', 'When it is hidden, Alt still opens it.', (box) => {
        box.addEventListener('change', () => set({ menuBarVisible: box.checked }));
        sync.push((s) => (box.checked = s.menuBarVisible));
      }),
    );
    panes.set('general', general).set('markup', markupPane).set('window', windowPane);

    const refresh = () => {
      const s = settings.get();
      for (const fn of sync) fn(s);
    };
    const refreshMarkup = () => {
      for (const fn of markupSync) fn();
    };

    const select = (id: PaneId, focus = false) => {
      this.pane = id;
      const label = PANES.find((p) => p.id === id)?.label ?? '';
      title.textContent = label;
      for (const [pid, t] of tabs) {
        const on = pid === id;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panes.get(pid)!.hidden = !on;
      }
      if (focus) tabs.get(id)?.focus();
    };

    win.append(titlebar, toolbar, ...panes.values());
    scrim.append(win);

    // ---- modality ----
    const focusables = (): HTMLElement[] =>
      [...win.querySelectorAll<HTMLElement>('button, select, input')].filter(
        (el) => el.tabIndex >= 0 && !(el as HTMLInputElement).disabled && el.getClientRects().length > 0,
      );
    const onKey = (e: KeyboardEvent) => {
      // Alerts (a close prompt, say) sit above this window and take the keys while they show.
      if (document.querySelector('.alert-scrim')) return;
      e.stopPropagation();
      if (e.isComposing) return;
      const active = document.activeElement;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'w' || e.code === 'KeyW')) this.close();
        return;
      }
      if (e.key === 'Escape') {
        // An open pop-up menu closes first.
        if (pickerOpen(active)) return;
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const list = focusables();
        const i = list.indexOf(active as HTMLElement);
        const next = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
        list[next]?.focus();
        return;
      }
      const tabIndex = PANES.findIndex((p) => tabs.get(p.id) === active);
      if (tabIndex >= 0) {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? PANES.length - 1 : step !== undefined ? (tabIndex + step + PANES.length) % PANES.length : -1;
        if (to >= 0) {
          e.preventDefault();
          select(PANES[to]!.id, true);
        }
      }
    };
    // Presses outside the window neither reach the app nor take focus away.
    scrim.addEventListener('pointerdown', (e) => {
      if (!win.contains(e.target as Node)) e.preventDefault();
    });
    scrim.addEventListener('contextmenu', (e) => e.preventDefault());

    const offSettings = settings.onChange(refresh);
    const offMarkup = markup.onChange(refreshMarkup);
    window.addEventListener('keydown', onKey, true);
    this.teardown = () => {
      offSettings();
      offMarkup();
      window.removeEventListener('keydown', onKey, true);
      const hadFocus = scrim.contains(document.activeElement);
      scrim.remove();
      if ((hadFocus || document.activeElement === document.body) && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };

    refresh();
    refreshMarkup();
    select(this.pane);
    this.scrim = scrim;
    document.body.append(scrim);
    win.focus();
  }

  close(): void {
    if (!this.scrim) return;
    this.scrim = null;
    const done = this.teardown;
    this.teardown = null;
    done?.();
  }

  // ---- building blocks ------------------------------------------------------

  private paneEl(id: PaneId): HTMLElement {
    const el = document.createElement('div');
    el.className = 'settings-pane';
    el.id = `settings-pane-${id}`;
    el.setAttribute('role', 'tabpanel');
    el.setAttribute('aria-labelledby', `settings-tab-${id}`);
    return el;
  }

  /** A right-aligned label and its control, with an optional grey caption under the control. */
  private row(label: string, id: string, control: (id: string) => HTMLElement, caption?: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const l = document.createElement('label');
    l.className = 'settings-label';
    l.htmlFor = id;
    l.textContent = label;
    const cell = document.createElement('div');
    cell.className = 'settings-control';
    cell.append(control(id));
    if (caption) cell.append(this.caption(caption));
    row.append(l, cell);
    return row;
  }

  /** A check box with its text; `label` (may be empty) sits in the label column. */
  private checkRow(label: string, text: string, caption: string | null, wire: (box: HTMLInputElement) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const l = document.createElement('span');
    l.className = 'settings-label';
    l.textContent = label;
    const cell = document.createElement('div');
    cell.className = 'settings-control';
    const check = document.createElement('label');
    check.className = 'settings-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    const t = document.createElement('span');
    t.textContent = text;
    check.append(box, t);
    cell.append(check);
    if (caption) cell.append(this.caption(caption));
    row.append(l, cell);
    wire(box);
    return row;
  }

  private caption(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'settings-caption';
    p.textContent = text;
    return p;
  }

  /** A macOS pop-up button: a native select drawn with an accent chevron square and the app's menu look. */
  private popup(id: string, choices: readonly Choice[], onPick: (value: string) => void): HTMLSelectElement {
    const el = document.createElement('select');
    el.className = 'settings-popup';
    el.id = id;
    // Customizable select: the button shows the chosen option, swatch included, and the chevrons.
    const button = document.createElement('button');
    const arrows = document.createElement('span');
    arrows.className = 'settings-popup-arrows';
    arrows.innerHTML = popupArrows;
    button.append(document.createElement('selectedcontent'), arrows);
    el.append(button);
    for (const c of choices) el.append(this.option(c));
    el.addEventListener('change', () => onPick(el.value));
    return el;
  }

  private option(c: Choice): HTMLOptionElement {
    const o = document.createElement('option');
    o.value = c.value;
    if (c.swatch) {
      const s = document.createElement('span');
      s.className = 'settings-swatch';
      s.style.setProperty('--swatch', c.swatch);
      o.append(s);
    }
    o.append(c.label);
    return o;
  }

  /** Shows `value`; a value the list does not offer (set elsewhere) gets its own extra item. */
  private setPopup(el: HTMLSelectElement, value: string, extra?: { label: string; swatch?: boolean }): void {
    const offered = [...el.options].some((o) => o.value === value && !o.dataset['extra']);
    el.querySelector('option[data-extra]')?.remove();
    if (!offered && extra) {
      const o = this.option({ value, label: extra.label, swatch: extra.swatch ? value : undefined });
      o.dataset['extra'] = '';
      el.append(o);
    }
    el.value = value;
  }
}

/** True when `el` is in a select whose menu is showing. */
function pickerOpen(el: Element | null): boolean {
  const sel = el?.closest('select');
  if (!sel) return false;
  try {
    return sel.matches(':open');
  } catch {
    return false; // engines without :open have no customizable select either
  }
}
