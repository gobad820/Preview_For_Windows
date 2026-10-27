import type { Store, ViewerState } from '../store';
import type { Color } from '../annot/types';
import { t } from '../i18n';
import type { ZoomMode } from '../types';
import { icons } from '../ui/icons';
import { i18n, localize } from '../ui/localize';
import { closeMenus, showMenu, type MenuItem } from '../ui/menu';
import { formatZoom } from '../viewer/zoom';

export interface ToolbarActions {
  toggleSidebar(): void;
  gotoPage(page: number): void;
  zoomIn(): void;
  zoomOut(): void;
  setZoom(mode: ZoomMode, scale?: number): void;
  rotate(): void;
  toggleFind(): void;
  open(): void;
  /** Shows the ⋯ menu below `anchor`, the ⋯ button's rect. */
  moreMenu(anchor: DOMRect): void;
  /** Shows or hides the markup toolbar row. */
  toggleMarkup(): void;
  /** The highlight button's main part: marks the selection or toggles highlight mode. */
  highlight(): void;
  /** The highlight button's chevron: color and kind menu below `anchor`. */
  highlightMenu(anchor: DOMRect): void;
  /** The chevron next to the sidebar button: View menu below `anchor`. */
  viewMenu(anchor: DOMRect): void;
}

/** What the highlight button shows: whether highlight mode is on and the current mark style. */
export interface HighlightButtonState {
  on: boolean;
  color: Color;
  kind: 'highlight' | 'underline' | 'strikeout';
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
const ZOOM_SHORTCUTS: Record<string, string> = { 'fit-width': 'Ctrl+1', 'fit-page': 'Ctrl+2', '1': 'Ctrl+0' };

/**
 * Unified title bar and toolbar (52px). The bar and the title block are window drag regions;
 * controls are not. `#findbar` lives in the search slot and replaces the search button while open.
 * Text comes from message keys (`data-i18n*`, see `localize`) and follows the UI language.
 */
const template = `
  <button class="tb-btn" data-action="sidebar" ${i18n({ title: 'chrome.tb.sidebar', keys: 'Ctrl+Alt+S', label: 'chrome.tb.sidebarLabel' })} aria-pressed="false">${icons.sidebar}</button>
  <button class="tb-btn tb-chevron" data-action="view-menu" ${i18n({ title: 'chrome.tb.view', label: 'chrome.tb.viewLabel' })} aria-haspopup="menu" aria-expanded="false">${icons.chevronDown}</button>
  <div class="tb-title" data-tauri-drag-region>
    <div class="tb-title-line" data-tauri-drag-region>
      <span class="tb-doc-title" data-doc-title data-tauri-drag-region>Preview</span>
      <span class="tb-doc-edited" data-doc-edited data-tauri-drag-region hidden></span>
    </div>
    <div class="tb-subtitle" data-tauri-drag-region hidden>
      <input class="tb-page-input" data-page-input ${i18n({ label: 'chrome.tb.pageNumber' })} type="text" inputmode="numeric" autocomplete="off" spellcheck="false" disabled />
      <span class="tb-page-total" data-page-total data-tauri-drag-region>–</span>
    </div>
  </div>
  <div class="tb-flex" data-tauri-drag-region></div>
  <div class="tb-items">
    <div class="tb-split" role="group" ${i18n({ label: 'chrome.mk.highlight' })}>
      <button class="tb-btn tb-split-main" data-action="highlight" ${i18n({ title: 'chrome.mk.highlight', label: 'chrome.mk.highlight' })} aria-pressed="false" disabled>${icons.highlighter}<span class="tb-swatch" data-highlight-swatch></span></button>
      <button class="tb-btn tb-split-menu" data-action="highlight-menu" ${i18n({ title: 'chrome.mk.highlightStyle', label: 'chrome.mk.highlightStyleLabel' })} aria-haspopup="menu" aria-expanded="false" disabled>${icons.chevronDown}</button>
    </div>
    <button class="tb-btn" data-action="markup" ${i18n({ title: 'chrome.tb.markup', keys: 'Ctrl+Shift+A', label: 'chrome.tb.markupLabel' })} aria-pressed="false" disabled>${icons.markup}</button>
    <div class="tb-segmented" role="group" ${i18n({ label: 'chrome.tb.zoom' })}>
      <button class="tb-btn" data-action="zoom-out" ${i18n({ title: 'chrome.tb.zoomOut', keys: 'Ctrl+-', label: 'chrome.tb.zoomOutLabel' })} disabled>${icons.zoomOut}</button>
      <button class="tb-btn" data-action="zoom-in" ${i18n({ title: 'chrome.tb.zoomIn', keys: 'Ctrl+=', label: 'chrome.tb.zoomInLabel' })} disabled>${icons.zoomIn}</button>
    </div>
    <button class="tb-pill" data-zoom-menu aria-haspopup="menu" aria-expanded="false" disabled><span class="tb-pill-label">100%</span>${icons.chevronDown}</button>
    <button class="tb-btn tb-rotate" data-action="rotate" ${i18n({ title: 'chrome.tb.rotate', keys: 'Ctrl+L', label: 'chrome.tb.rotateLabel' })} disabled>${icons.rotateRight}</button>
    <button class="tb-btn" data-action="more" ${i18n({ title: 'chrome.tb.more', label: 'chrome.tb.more' })} aria-haspopup="menu">${icons.ellipsis}</button>
    <div class="tb-search">
      <button class="tb-btn" data-action="find" ${i18n({ title: 'chrome.search', keys: 'Ctrl+F', label: 'chrome.tb.find' })} aria-pressed="false" disabled>${icons.search}</button>
      <div id="findbar" class="findbar" hidden></div>
    </div>
  </div>
`;
export class Toolbar {
  private readonly pageInput: HTMLInputElement;
  private readonly pageTotal: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly docTitle: HTMLElement;
  private readonly edited: HTMLElement;
  private readonly zoomButton: HTMLButtonElement;
  private readonly zoomLabel: HTMLElement;
  private readonly docControls: HTMLButtonElement[];
  private readonly unsubscribe: Array<() => void> = [];
  private zoomMenuOpen = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Store<ViewerState>,
    private readonly actions: ToolbarActions,
  ) {
    host.innerHTML = template;
    host.setAttribute('data-tauri-drag-region', '');
    this.pageInput = this.q('[data-page-input]');
    this.pageTotal = this.q('[data-page-total]');
    this.subtitle = this.q('.tb-subtitle');
    this.docTitle = this.q('[data-doc-title]');
    this.edited = this.q('[data-doc-edited]');
    this.zoomButton = this.q('[data-zoom-menu]');
    this.zoomLabel = this.q('.tb-pill-label');
    this.docControls = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '[data-action="zoom-out"], [data-action="zoom-in"], [data-action="rotate"], [data-action="find"], ' +
          '[data-action="highlight"], [data-action="highlight-menu"], [data-action="markup"]',
      ),
    );

    this.q('[data-action="sidebar"]').addEventListener('click', () => actions.toggleSidebar());
    this.q('[data-action="zoom-out"]').addEventListener('click', () => actions.zoomOut());
    this.q('[data-action="zoom-in"]').addEventListener('click', () => actions.zoomIn());
    this.q('[data-action="rotate"]').addEventListener('click', () => actions.rotate());
    this.q('[data-action="find"]').addEventListener('click', () => actions.toggleFind());
    const more = this.q('[data-action="more"]');
    more.addEventListener('click', () => actions.moreMenu(more.getBoundingClientRect()));
    this.q('[data-action="markup"]').addEventListener('click', () => actions.toggleMarkup());
    this.q('[data-action="highlight"]').addEventListener('click', () => actions.highlight());
    const highlightMenu = this.q('[data-action="highlight-menu"]');
    highlightMenu.addEventListener('click', () => actions.highlightMenu(highlightMenu.closest('.tb-split')!.getBoundingClientRect()));
    const viewMenu = this.q('[data-action="view-menu"]');
    viewMenu.addEventListener('click', () => actions.viewMenu(this.q('[data-action="sidebar"]').getBoundingClientRect()));
    this.zoomButton.addEventListener('click', () => this.openZoomMenu());

    this.pageInput.addEventListener('focus', () => this.pageInput.select());
    this.pageInput.addEventListener('input', () => this.fitPageInput());
    this.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitPage();
        this.pageInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.syncPage(this.store.get().currentPage);
        this.pageInput.blur();
      }
    });
    this.pageInput.addEventListener('blur', () => this.syncPage(this.store.get().currentPage));

    this.unsubscribe.push(
      store.select('numPages', (n) => {
        this.pageTotal.textContent = n > 0 ? String(n) : '–';
        const disabled = n === 0;
        this.pageInput.disabled = disabled;
        this.zoomButton.disabled = disabled;
        for (const b of this.docControls) b.disabled = disabled;
        if (disabled && this.zoomMenuOpen) closeMenus();
      }),
      store.select('currentPage', (p) => {
        if (document.activeElement !== this.pageInput) this.syncPage(p);
      }),
      store.subscribe((s, prev) => {
        if (s.zoomMode !== prev.zoomMode || s.scale !== prev.scale) this.syncZoom(s);
        if (s.sidebarOpen !== prev.sidebarOpen) this.pressed('sidebar', s.sidebarOpen);
        if (s.markupOpen !== prev.markupOpen) this.pressed('markup', s.markupOpen);
        if (s.findOpen !== prev.findOpen) this.syncFind(s.findOpen);
        if (s.fileName !== prev.fileName || s.numPages !== prev.numPages || s.dirty !== prev.dirty) this.syncTitle(s);
      }),
    );
    this.unsubscribe.push(store.select('locale', () => this.relabel()));
    this.pressed('sidebar', store.get().sidebarOpen);
    this.syncFind(store.get().findOpen);
  }

  /** Reflects highlight mode and the current mark style on the highlight button. */
  setHighlight(state: HighlightButtonState): void {
    this.pressed('highlight', state.on);
    const swatch = this.q('[data-highlight-swatch]');
    swatch.style.setProperty('--swatch', state.color);
    swatch.dataset['kind'] = state.kind;
  }

  /** Reflects on the View chevron whether its menu is open. */
  setViewMenuOpen(open: boolean): void {
    this.q('[data-action="view-menu"]').setAttribute('aria-expanded', String(open));
  }

  focusPageInput(): void {
    if (this.pageInput.disabled) return;
    this.pageInput.focus();
    this.pageInput.select();
  }

  destroy(): void {
    for (const u of this.unsubscribe) u();
    if (this.zoomMenuOpen) closeMenus();
    this.host.classList.remove('find-open');
    this.host.innerHTML = '';
  }

  // ---- internals ----------------------------------------------------------

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.host.querySelector<T>(selector);
    if (!el) throw new Error(`toolbar: missing ${selector}`);
    return el;
  }

  private pressed(action: string, on: boolean): void {
    this.q(`[data-action="${action}"]`).setAttribute('aria-pressed', String(on));
  }

  /** Writes every text of the bar in the current UI language. */
  private relabel(): void {
    localize(this.host);
    this.layoutSubtitle();
    this.syncZoom(this.store.get());
    this.syncTitle(this.store.get());
  }

  /**
   * Lays out "Page [n] of N" from its message, so each language keeps its own word order: the
   * page field between runs of text, the page count inside the run its message puts it in.
   */
  private layoutSubtitle(): void {
    const PAGE = '\u0001';
    const TOTAL = '\u0002';
    const run = (text: string) => {
      const span = document.createElement('span');
      span.setAttribute('data-tauri-drag-region', '');
      const [head = '', tail] = text.trim().split(TOTAL);
      span.append(head);
      if (tail !== undefined) span.append(this.pageTotal, tail);
      return span;
    };
    const [before = '', after = ''] = t('chrome.tb.pageOf', { page: PAGE, total: TOTAL }).split(PAGE);
    this.subtitle.replaceChildren(
      ...(before.trim() ? [run(before)] : []),
      this.pageInput,
      ...(after.trim() ? [run(after)] : []),
    );
  }

  private syncFind(open: boolean): void {
    this.pressed('find', open);
    this.host.classList.toggle('find-open', open);
  }

  /** "Preview" without a document; otherwise the file name, " — Edited" while dirty and "Page N of M". */
  private syncTitle(s: ViewerState): void {
    const hasDoc = s.numPages > 0;
    const name = hasDoc && s.fileName ? s.fileName : 'Preview';
    this.docTitle.textContent = name;
    this.q('.tb-title').title = hasDoc ? name : '';
    this.edited.textContent = `— ${t('chrome.edited')}`;
    this.edited.hidden = !(hasDoc && s.dirty);
    this.subtitle.hidden = !hasDoc;
  }

  private syncPage(page: number): void {
    this.pageInput.value = page > 0 ? String(page) : '';
    this.fitPageInput();
  }

  /** Sizes the page field to its digits so "Page 3 of 12" reads as one line of text. */
  private fitPageInput(): void {
    this.pageInput.style.width = `calc(${Math.max(1, this.pageInput.value.length)}ch + 6px)`;
  }

  private commitPage(): void {
    const n = Math.round(Number(this.pageInput.value));
    const total = this.store.get().numPages;
    if (!Number.isFinite(n) || total === 0) {
      this.syncPage(this.store.get().currentPage);
      return;
    }
    const clamped = Math.min(Math.max(1, n), total);
    this.syncPage(clamped);
    this.actions.gotoPage(clamped);
  }

  private syncZoom(s: ViewerState): void {
    const label =
      s.zoomMode === 'fit-width' ? t('chrome.tb.fitWidth') : s.zoomMode === 'fit-page' ? t('chrome.tb.fitPage') : formatZoom(s.scale);
    this.zoomLabel.textContent = label;
    this.zoomButton.title = t('chrome.tb.zoomTitle', { zoom: formatZoom(s.scale) });
  }

  private openZoomMenu(): void {
    const s = this.store.get();
    const fit = (mode: 'fit-width' | 'fit-page', label: string): MenuItem => ({
      label,
      shortcut: ZOOM_SHORTCUTS[mode],
      radio: true,
      checked: s.zoomMode === mode,
      action: () => this.actions.setZoom(mode),
    });
    const items: MenuItem[] = [
      fit('fit-width', t('menu.view.fitWidth')),
      fit('fit-page', t('menu.view.fitPage')),
      'separator',
      ...ZOOM_PRESETS.map(
        (z): MenuItem => ({
          label: formatZoom(z),
          shortcut: ZOOM_SHORTCUTS[String(z)],
          radio: true,
          checked: s.zoomMode === 'custom' && s.scale === z,
          action: () => this.actions.setZoom('custom', z),
        }),
      ),
    ];
    this.zoomMenuOpen = true;
    this.zoomButton.setAttribute('aria-expanded', 'true');
    void showMenu(this.zoomButton.getBoundingClientRect(), items, { minWidth: this.zoomButton.offsetWidth }).then(() => {
      this.zoomMenuOpen = false;
      this.zoomButton.setAttribute('aria-expanded', 'false');
    });
  }
}
