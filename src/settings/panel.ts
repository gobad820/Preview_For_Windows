/**
 * The Settings window, in the manner of a modern macOS app's Settings: the pane's name over a
 * toolbar of pane icons (the selected one tinted on a pressed fill), then a pane of right-aligned
 * labels, pop-up buttons and check boxes. It sits inside the app window and is modal: keys,
 * presses and focus stay in it until it closes (close button, Esc or Ctrl+W). Changes apply at once;
 * a new UI language re-renders it in place.
 */
import { t, type Language, type MessageKey } from '../i18n';
import {
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  LINE_WIDTHS,
  PALETTE,
  type MarkupState,
  type NamedColor,
} from '../markup/state';
import type { Store, ViewerState } from '../store';
import { closeMenus } from '../ui/menu';
import { popupArrows, settingsIcons } from './icons';
import type { DefaultZoom, Settings, SettingsModel } from './settings';

export type PaneId = 'general' | 'markup' | 'window';

const PANES: ReadonlyArray<{ id: PaneId; label: MessageKey }> = [
  { id: 'general', label: 'dlg.settings.general' },
  { id: 'markup', label: 'dlg.settings.markup' },
  { id: 'window', label: 'dlg.settings.window' },
];

const ZOOM_CHOICES: ReadonlyArray<{ value: DefaultZoom; label: MessageKey }> = [
  { value: 'fit-width', label: 'dlg.settings.fitWidth' },
  { value: 'fit-page', label: 'dlg.settings.fitPage' },
  { value: 'actual-size', label: 'dlg.settings.actualSize' },
];

/** Each language is named in itself, whatever the UI language. */
const LANGUAGE_NAMES: readonly Choice[] = [
  { value: 'en', label: 'English', lang: 'en' },
  { value: 'ko', label: '한국어', lang: 'ko' },
];

interface Choice {
  value: string;
  label: string;
  /** Shown as a color swatch before the label. */
  swatch?: string;
  /** Language of the label, when it is not the UI's. */
  lang?: string;
}

/** The palettes name their colours in the current UI language, as the markup toolbar shows them. */
const colorChoices = (colors: readonly NamedColor[]): Choice[] =>
  colors.map((c) => ({ value: c.color, label: c.name, swatch: c.color }));
const pt = (n: number) => t('chrome.mk.points', { n });
const points = (values: readonly number[]): Choice[] => values.map((v) => ({ value: String(v), label: pt(v) }));

export interface SettingsWindowDeps {
  settings: SettingsModel;
  markup: MarkupState;
  /** Its `locale`: an open window re-renders in the new UI language. */
  store: Pick<Store<ViewerState>, 'select'>;
}

/** The window's contents in one UI language. */
interface Contents {
  tabs: ReadonlyMap<PaneId, HTMLButtonElement>;
  select(id: PaneId, focus?: boolean): void;
  /** Show the current settings and markup defaults. */
  refresh(): void;
  refreshMarkup(): void;
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
    const { settings, markup, store } = this.deps;

    const scrim = document.createElement('div');
    scrim.className = 'settings-scrim';
    const win = document.createElement('section');
    win.className = 'settings-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.tabIndex = -1;
    scrim.append(win);

    // Built now and again in each new UI language. The controls are the same, in the same
    // order, so the one that had focus (the Language pop-up, say) gets it back.
    let ui!: Contents;
    const controls = () => [...win.querySelectorAll<HTMLElement>('button, select, input')];
    const offLocale = store.select('locale', () => {
      const focused = controls().indexOf(document.activeElement as HTMLElement);
      ui = this.build(win);
      if (focused >= 0) controls()[focused]?.focus();
    });

    // ---- modality ----
    const focusables = (): HTMLElement[] =>
      controls().filter((el) => el.tabIndex >= 0 && !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
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
      const tabIndex = PANES.findIndex((p) => ui.tabs.get(p.id) === active);
      if (tabIndex >= 0) {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? PANES.length - 1 : step !== undefined ? (tabIndex + step + PANES.length) % PANES.length : -1;
        if (to >= 0) {
          e.preventDefault();
          ui.select(PANES[to]!.id, true);
        }
      }
    };
    // Presses outside the window neither reach the app nor take focus away.
    scrim.addEventListener('pointerdown', (e) => {
      if (!win.contains(e.target as Node)) e.preventDefault();
    });
    scrim.addEventListener('contextmenu', (e) => e.preventDefault());

    const offSettings = settings.onChange(() => ui.refresh());
    const offMarkup = markup.onChange(() => ui.refreshMarkup());
    window.addEventListener('keydown', onKey, true);
    this.teardown = () => {
      offLocale();
      offSettings();
      offMarkup();
      window.removeEventListener('keydown', onKey, true);
      const hadFocus = scrim.contains(document.activeElement);
      scrim.remove();
      if ((hadFocus || document.activeElement === document.body) && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };

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

  /** Fills `win` with the title bar, pane toolbar and panes in the current UI language. */
  private build(win: HTMLElement): Contents {
    const { settings, markup } = this.deps;
    win.setAttribute('aria-label', t('dlg.settings.title'));

    // ---- title bar ----
    const titlebar = document.createElement('header');
    titlebar.className = 'settings-titlebar';
    const lights = document.createElement('div');
    lights.className = 'settings-lights';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'settings-light settings-close';
    close.setAttribute('aria-label', t('dlg.settings.close'));
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
    toolbar.setAttribute('aria-label', t('dlg.settings.title'));
    const tabs = new Map<PaneId, HTMLButtonElement>();
    const panes = new Map<PaneId, HTMLElement>();
    for (const p of PANES) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'settings-tab';
      tab.id = `settings-tab-${p.id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `settings-pane-${p.id}`);
      tab.innerHTML = `<span class="settings-tab-icon">${settingsIcons[p.id]}</span>`;
      const label = document.createElement('span');
      label.className = 'settings-tab-label';
      label.textContent = t(p.label);
      tab.append(label);
      tab.addEventListener('click', () => select(p.id));
      tabs.set(p.id, tab);
      toolbar.append(tab);
    }

    // ---- panes ----
    const sync: Array<(s: Settings) => void> = [];
    const set = (patch: Partial<Settings>) => settings.set(patch);

    const general = this.paneEl('general');
    general.append(
      this.row(t('dlg.settings.language'), 'settings-language', (id) => {
        const el = this.popup(
          id,
          [{ value: 'system', label: t('dlg.settings.language.system') }, ...LANGUAGE_NAMES],
          (v) => set({ language: v as Language }),
        );
        sync.push((s) => this.setPopup(el, s.language));
        return el;
      }, t('dlg.settings.language.caption')),
      this.row(t('dlg.settings.defaultZoom'), 'settings-zoom', (id) => {
        const el = this.popup(
          id,
          ZOOM_CHOICES.map((c) => ({ value: c.value, label: t(c.label) })),
          (v) => set({ defaultZoom: v as DefaultZoom }),
        );
        sync.push((s) => this.setPopup(el, s.defaultZoom));
        return el;
      }, t('dlg.settings.defaultZoom.caption')),
      this.row(t('dlg.settings.pageLayout'), 'settings-layout', (id) => {
        const el = this.popup(
          id,
          [
            { value: 'continuous', label: t('dlg.settings.continuous') },
            { value: 'two-pages', label: t('dlg.settings.twoPages') },
          ],
          (v) => set({ displayMode: v === 'two-pages' ? 'two-pages' : 'continuous' }),
        );
        sync.push((s) => this.setPopup(el, s.displayMode));
        return el;
      }),
      this.checkRow('', t('dlg.settings.bookMode'), t('dlg.settings.bookMode.caption'), (box) => {
        box.addEventListener('change', () => set({ bookMode: box.checked }));
        sync.push((s) => {
          box.checked = s.bookMode;
          box.disabled = s.displayMode !== 'two-pages';
        });
      }),
      this.checkRow(t('dlg.settings.sidebar'), t('dlg.settings.sidebarOnOpen'), null, (box) => {
        box.addEventListener('change', () => set({ sidebarOnOpen: box.checked }));
        sync.push((s) => (box.checked = s.sidebarOnOpen));
      }),
      this.checkRow(
        t('dlg.settings.documents'),
        t('dlg.settings.rememberPosition'),
        t('dlg.settings.rememberPosition.caption'),
        (box) => {
          box.addEventListener('change', () => set({ rememberPosition: box.checked }));
          sync.push((s) => (box.checked = s.rememberPosition));
        },
      ),
    );

    const markupPane = this.paneEl('markup');
    const markupSync: Array<() => void> = [];
    const custom = { label: t('dlg.settings.custom'), swatch: true };
    markupPane.append(
      this.row(t('dlg.settings.highlightColor'), 'settings-highlight', (id) => {
        const el = this.popup(id, colorChoices(HIGHLIGHT_COLORS), (v) => markup.setMarkColor('highlight', v));
        markupSync.push(() => this.setPopup(el, markup.markColorFor('highlight'), custom));
        return el;
      }),
      this.row(t('dlg.settings.shapeColor'), 'settings-stroke', (id) => {
        const el = this.popup(id, colorChoices(PALETTE), (v) => markup.setStyles({ stroke: v }));
        markupSync.push(() => this.setPopup(el, markup.styles.stroke, custom));
        return el;
      }, t('dlg.settings.shapeColor.caption')),
      this.row(t('dlg.settings.lineWidth'), 'settings-width', (id) => {
        const el = this.popup(id, points(LINE_WIDTHS), (v) => markup.setStyles({ width: Number(v) }));
        markupSync.push(() => this.setPopup(el, String(markup.styles.width), { label: pt(markup.styles.width) }));
        return el;
      }),
      this.row(t('dlg.settings.textSize'), 'settings-font-size', (id) => {
        const el = this.popup(id, points(FONT_SIZES), (v) => markup.setStyles({ fontSize: Number(v) }));
        markupSync.push(() => this.setPopup(el, String(markup.styles.fontSize), { label: pt(markup.styles.fontSize) }));
        return el;
      }, t('dlg.settings.textSize.caption')),
    );

    const windowPane = this.paneEl('window');
    windowPane.append(
      this.checkRow(t('dlg.settings.menuBar'), t('dlg.settings.showMenuBar'), t('dlg.settings.showMenuBar.caption'), (box) => {
        box.addEventListener('change', () => set({ menuBarVisible: box.checked }));
        sync.push((s) => (box.checked = s.menuBarVisible));
      }),
    );
    panes.set('general', general).set('markup', markupPane).set('window', windowPane);

    const select = (id: PaneId, focus = false) => {
      this.pane = id;
      title.textContent = t(PANES.find((p) => p.id === id)!.label);
      for (const [pid, tab] of tabs) {
        const on = pid === id;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        panes.get(pid)!.hidden = !on;
      }
      if (focus) tabs.get(id)?.focus();
    };

    win.replaceChildren(titlebar, toolbar, ...panes.values());
    const contents: Contents = {
      tabs,
      select,
      refresh: () => {
        const s = settings.get();
        for (const fn of sync) fn(s);
      },
      refreshMarkup: () => {
        for (const fn of markupSync) fn();
      },
    };
    contents.refresh();
    contents.refreshMarkup();
    select(this.pane);
    return contents;
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
    if (c.lang) o.lang = c.lang;
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
