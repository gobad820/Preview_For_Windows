import type { WindowControls } from '../platform/types';
import type { Store, ViewerState } from '../store';
import type { ZoomMode } from '../types';
import { icons } from '../ui/icons';
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
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
const ZOOM_SHORTCUTS: Record<string, string> = { 'fit-width': 'Ctrl+1', 'fit-page': 'Ctrl+2', '1': 'Ctrl+0' };

/** Caption glyphs from "Segoe Fluent Icons" / "Segoe MDL2 Assets". */
const GLYPH = { minimize: '', maximize: '', restore: '', close: '' } as const;

/**
 * Unified title bar and toolbar (52px). The bar and the title block are window drag regions;
 * controls are not. `#findbar` lives in the search slot and replaces the search button while open.
 */
const template = `
  <button class="tb-btn" data-action="sidebar" title="Sidebar (Ctrl+Alt+S)" aria-label="Toggle sidebar" aria-pressed="false">${icons.sidebar}</button>
  <div class="tb-title" data-tauri-drag-region>
    <div class="tb-title-line" data-tauri-drag-region>
      <span class="tb-doc-title" data-doc-title data-tauri-drag-region>Preview</span>
      <span class="tb-doc-edited" data-doc-edited data-tauri-drag-region hidden>— Edited</span>
    </div>
    <div class="tb-subtitle" data-tauri-drag-region hidden>
      <span data-tauri-drag-region>Page</span>
      <input class="tb-page-input" data-page-input type="text" inputmode="numeric" aria-label="Page number" autocomplete="off" spellcheck="false" disabled />
      <span data-tauri-drag-region>of</span>
      <span class="tb-page-total" data-page-total data-tauri-drag-region>–</span>
    </div>
  </div>
  <div class="tb-flex" data-tauri-drag-region></div>
  <div class="tb-items">
    <div class="tb-segmented" role="group" aria-label="Zoom">
      <button class="tb-btn" data-action="zoom-out" title="Zoom Out (Ctrl+-)" aria-label="Zoom out" disabled>${icons.zoomOut}</button>
      <button class="tb-btn" data-action="zoom-in" title="Zoom In (Ctrl+=)" aria-label="Zoom in" disabled>${icons.zoomIn}</button>
    </div>
    <button class="tb-pill" data-zoom-menu title="Zoom" aria-haspopup="menu" aria-expanded="false" disabled><span class="tb-pill-label">100%</span>${icons.chevronDown}</button>
    <button class="tb-btn tb-rotate" data-action="rotate" title="Rotate (Ctrl+L)" aria-label="Rotate clockwise" disabled>${icons.rotateRight}</button>
    <button class="tb-btn" data-action="more" title="More" aria-label="More" aria-haspopup="menu">${icons.ellipsis}</button>
    <div class="tb-search">
      <button class="tb-btn" data-action="find" title="Search (Ctrl+F)" aria-label="Find" aria-pressed="false" disabled>${icons.search}</button>
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
    windowControls: WindowControls | null = null,
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
      host.querySelectorAll<HTMLButtonElement>('[data-action="zoom-out"], [data-action="zoom-in"], [data-action="rotate"], [data-action="find"]'),
    );
    if (windowControls) this.addCaptionButtons(windowControls);

    this.q('[data-action="sidebar"]').addEventListener('click', () => actions.toggleSidebar());
    this.q('[data-action="zoom-out"]').addEventListener('click', () => actions.zoomOut());
    this.q('[data-action="zoom-in"]').addEventListener('click', () => actions.zoomIn());
    this.q('[data-action="rotate"]').addEventListener('click', () => actions.rotate());
    this.q('[data-action="find"]').addEventListener('click', () => actions.toggleFind());
    const more = this.q('[data-action="more"]');
    more.addEventListener('click', () => actions.moreMenu(more.getBoundingClientRect()));
    this.zoomButton.addEventListener('click', () => this.openZoomMenu());

    this.pageInput.addEventListener('focus', () => this.pageInput.select());
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
        this.pageInput.style.width = `calc(${String(Math.max(n, 1)).length}ch + 6px)`;
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
        if (s.findOpen !== prev.findOpen) this.syncFind(s.findOpen);
        if (s.fileName !== prev.fileName || s.numPages !== prev.numPages || s.dirty !== prev.dirty) this.syncTitle(s);
      }),
    );
    this.syncZoom(store.get());
    this.syncTitle(store.get());
    this.pressed('sidebar', store.get().sidebarOpen);
    this.syncFind(store.get().findOpen);
  }

  focusPageInput(): void {
    if (this.pageInput.disabled) return;
    this.pageInput.focus();
    this.pageInput.select();
  }

  destroy(): void {
    for (const u of this.unsubscribe) u();
    if (this.zoomMenuOpen) closeMenus();
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
    this.edited.hidden = !(hasDoc && s.dirty);
    this.subtitle.hidden = !hasDoc;
  }

  private syncPage(page: number): void {
    this.pageInput.value = page > 0 ? String(page) : '';
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
    const label = s.zoomMode === 'fit-width' ? 'Fit Width' : s.zoomMode === 'fit-page' ? 'Fit Page' : formatZoom(s.scale);
    this.zoomLabel.textContent = label;
    this.zoomButton.title = `Zoom: ${formatZoom(s.scale)}`;
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
      fit('fit-width', 'Fit Width'),
      fit('fit-page', 'Fit Page'),
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

  private addCaptionButtons(controls: WindowControls): void {
    const group = document.createElement('div');
    group.className = 'tb-caption';
    const make = (kind: 'minimize' | 'maximize' | 'close', label: string, run: () => Promise<void>) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset['window'] = kind;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = GLYPH[kind];
      b.addEventListener('click', () => void run());
      group.append(b);
      return b;
    };
    make('minimize', 'Minimize', () => controls.minimize());
    const max = make('maximize', 'Maximize', () => controls.toggleMaximize());
    make('close', 'Close', () => controls.close());
    this.host.append(group);
    this.host.classList.add('has-caption');

    const sync = (maximized: boolean) => {
      max.textContent = maximized ? GLYPH.restore : GLYPH.maximize;
      max.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
      max.title = maximized ? 'Restore Down' : 'Maximize';
    };
    this.unsubscribe.push(controls.onMaximizedChange(sync));
    void controls.isMaximized().then(sync, () => {});
  }
}
