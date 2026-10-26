import type { Store, ViewerState } from '../store';
import type { ZoomMode } from '../types';
import { icons } from '../ui/icons';
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
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];

const template = `
  <div class="tb-group">
    <button class="tb-btn" data-action="sidebar" title="Sidebar (Ctrl+Shift+S)" aria-label="Toggle sidebar" aria-pressed="false">${icons.sidebar}</button>
    <button class="tb-btn" data-action="open" title="Open… (Ctrl+O)" aria-label="Open file">${icons.open}</button>
  </div>
  <div class="tb-spacer"></div>
  <div class="tb-group tb-page">
    <input class="tb-input" data-page-input type="text" inputmode="numeric" aria-label="Page number" disabled />
    <span class="tb-sep" aria-hidden="true">/</span>
    <span class="tb-total" data-page-total>–</span>
  </div>
  <div class="tb-spacer"></div>
  <div class="tb-group">
    <button class="tb-btn" data-action="zoom-out" title="Zoom Out (Ctrl+-)" aria-label="Zoom out" disabled>${icons.minus}</button>
    <button class="tb-btn tb-zoom" data-zoom-menu title="Zoom" aria-haspopup="menu" aria-expanded="false" disabled>100%</button>
    <button class="tb-btn" data-action="zoom-in" title="Zoom In (Ctrl+=)" aria-label="Zoom in" disabled>${icons.plus}</button>
  </div>
  <div class="tb-divider" aria-hidden="true"></div>
  <div class="tb-group">
    <button class="tb-btn" data-action="rotate" title="Rotate (Ctrl+L)" aria-label="Rotate clockwise" disabled>${icons.rotate}</button>
    <button class="tb-btn" data-action="find" title="Find (Ctrl+F)" aria-label="Find" aria-pressed="false" disabled>${icons.search}</button>
  </div>
  <div class="tb-menu" role="menu" hidden>
    <button role="menuitemradio" data-zoom="fit-width">Fit Width</button>
    <button role="menuitemradio" data-zoom="fit-page">Fit Page</button>
    <hr />
    ${ZOOM_PRESETS.map((z) => `<button role="menuitemradio" data-zoom="${z}">${formatZoom(z)}</button>`).join('')}
  </div>
`;

export class Toolbar {
  private readonly pageInput: HTMLInputElement;
  private readonly pageTotal: HTMLElement;
  private readonly zoomButton: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly docControls: HTMLButtonElement[];
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Store<ViewerState>,
    private readonly actions: ToolbarActions,
  ) {
    host.innerHTML = template;
    this.pageInput = this.q('[data-page-input]');
    this.pageTotal = this.q('[data-page-total]');
    this.zoomButton = this.q('[data-zoom-menu]');
    this.menu = this.q('[role="menu"]');
    this.docControls = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-action="zoom-out"], [data-action="zoom-in"], [data-action="rotate"], [data-action="find"]'),
    );

    this.q('[data-action="sidebar"]').addEventListener('click', () => actions.toggleSidebar());
    this.q('[data-action="open"]').addEventListener('click', () => actions.open());
    this.q('[data-action="zoom-out"]').addEventListener('click', () => actions.zoomOut());
    this.q('[data-action="zoom-in"]').addEventListener('click', () => actions.zoomIn());
    this.q('[data-action="rotate"]').addEventListener('click', () => actions.rotate());
    this.q('[data-action="find"]').addEventListener('click', () => actions.toggleFind());
    this.zoomButton.addEventListener('click', () => this.toggleMenu());
    this.menu.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-zoom]');
      if (!item) return;
      const z = item.dataset['zoom']!;
      if (z === 'fit-width' || z === 'fit-page') actions.setZoom(z);
      else actions.setZoom('custom', Number(z));
      this.closeMenu();
    });
    document.addEventListener('mousedown', this.onDocumentMouseDown, true);
    document.addEventListener('keydown', this.onDocumentKeyDown, true);

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
        const disabled = n === 0;
        this.pageInput.disabled = disabled;
        this.zoomButton.disabled = disabled;
        for (const b of this.docControls) b.disabled = disabled;
        if (disabled) this.closeMenu();
      }),
      store.select('currentPage', (p) => {
        if (document.activeElement !== this.pageInput) this.syncPage(p);
      }),
      store.subscribe((s, prev) => {
        if (s.zoomMode !== prev.zoomMode || s.scale !== prev.scale) this.syncZoom(s);
        if (s.sidebarOpen !== prev.sidebarOpen) this.pressed('sidebar', s.sidebarOpen);
        if (s.findOpen !== prev.findOpen) this.pressed('find', s.findOpen);
      }),
    );
    this.syncZoom(store.get());
    this.pressed('sidebar', store.get().sidebarOpen);
    this.pressed('find', store.get().findOpen);
  }

  focusPageInput(): void {
    if (this.pageInput.disabled) return;
    this.pageInput.focus();
    this.pageInput.select();
  }

  destroy(): void {
    for (const u of this.unsubscribe) u();
    document.removeEventListener('mousedown', this.onDocumentMouseDown, true);
    document.removeEventListener('keydown', this.onDocumentKeyDown, true);
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
    this.zoomButton.textContent = label;
    this.zoomButton.title = `Zoom: ${formatZoom(s.scale)}`;
    for (const item of this.menu.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
      const z = item.dataset['zoom']!;
      const active =
        (z === 'fit-width' || z === 'fit-page') ? s.zoomMode === z : s.zoomMode === 'custom' && Number(z) === s.scale;
      item.setAttribute('aria-checked', String(active));
    }
  }

  private toggleMenu(): void {
    if (this.menu.hidden) this.openMenu();
    else this.closeMenu();
  }

  private openMenu(): void {
    const left = this.zoomButton.offsetLeft + this.zoomButton.offsetWidth / 2;
    this.menu.style.left = `${left}px`;
    this.menu.hidden = false;
    this.zoomButton.setAttribute('aria-expanded', 'true');
  }

  private closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.zoomButton.setAttribute('aria-expanded', 'false');
  }

  private readonly onDocumentMouseDown = (e: MouseEvent): void => {
    if (this.menu.hidden) return;
    const t = e.target as Node;
    if (!this.menu.contains(t) && !this.zoomButton.contains(t)) this.closeMenu();
  };

  private readonly onDocumentKeyDown = (e: KeyboardEvent): void => {
    if (!this.menu.hidden && e.key === 'Escape') {
      e.stopPropagation();
      this.closeMenu();
    }
  };
}
