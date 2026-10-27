import type { Editor } from '../edit/editor';
import { t, type MessageKey } from '../i18n';
import type { PageSource } from '../pdf/source';
import type { Point } from '../platform/types';
import type { PageRenderer } from '../pdf/renderer';
import type { SidebarTab, Store, ViewerState } from '../store';
import { OutlineTree } from './outline';
import { ThumbnailList } from './thumbnails';

export interface SidebarDeps {
  doc: PageSource | null;
  renderer: PageRenderer | null;
  goToPage(index: number, top?: number): void;
  editor: Editor;
  contextMenu(point: Point): void;
}

const TABS: { id: SidebarTab; label: MessageKey }[] = [
  { id: 'thumbnails', label: 'chrome.sidebar.thumbnails' },
  { id: 'outline', label: 'chrome.sidebar.contents' },
];

/**
 * Sidebar shell: a Thumbnails / Outline tab strip over one scrolling panel per tab.
 * Visibility (`hidden` on the host) is driven by whoever owns `sidebarOpen`; the active tab lives in
 * `store.sidebarTab`. Nothing in here ever takes keyboard focus away from the viewer.
 */
export class Sidebar {
  readonly thumbnails: ThumbnailList;
  readonly outline: OutlineTree;
  private doc: PageSource | null = null;
  private readonly tabs = new Map<SidebarTab, HTMLButtonElement>();
  private readonly panels = new Map<SidebarTab, HTMLElement>();
  private readonly unsubscribers: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Store<ViewerState>,
    deps: SidebarDeps,
  ) {
    const strip = document.createElement('div');
    strip.className = 'sidebar-tabs';
    strip.setAttribute('role', 'tablist');
    for (const { id } of TABS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'sidebar-tab';
      tab.tabIndex = -1;
      tab.dataset['tab'] = id;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => {
        if (!tab.disabled) this.store.set({ sidebarTab: id });
      });
      strip.append(tab);
      this.tabs.set(id, tab);

      const panel = document.createElement('div');
      panel.className = `sidebar-panel ${id}`;
      panel.dataset['panel'] = id;
      panel.setAttribute('role', 'tabpanel');
      panel.hidden = true;
      this.panels.set(id, panel);
    }
    host.append(strip, ...this.panels.values());
    // Buttons never take focus: mousedown's default action is what moves it.
    host.addEventListener('mousedown', (e) => {
      if ((e.target as Element | null)?.closest('button')) e.preventDefault();
    });

    this.thumbnails = new ThumbnailList(this.panels.get('thumbnails')!, store, {
      editor: deps.editor,
      contextMenu: (point) => deps.contextMenu(point),
    });
    this.outline = new OutlineTree(this.panels.get('outline')!, {
      goToPage: (index, top) => deps.goToPage(index, top),
    });
    this.setOutlineAvailable(false);

    this.unsubscribers.push(
      store.select('locale', () => this.relabel()),
      store.select('sidebarTab', (tab) => this.showTab(tab)),
      store.select('currentPage', (page) => this.thumbnails.setCurrent(page)),
      store.select('sidebarOpen', (open) => {
        // The owner un-hides the host in its own subscriber; sync once layout exists.
        if (open) requestAnimationFrame(() => this.thumbnails.scrollCurrentIntoView());
      }),
    );
    if (deps.doc) this.setDocument(deps.doc, deps.renderer);
  }

  /** Swaps the document shown; `renderer` must be a separate instance from the viewer's. */
  setDocument(doc: PageSource | null, renderer: PageRenderer | null): void {
    this.doc = doc;
    this.thumbnails.setDocument(doc, renderer);
    this.outline.setOutline([]);
    this.setOutlineAvailable(false);
    this.reloadOutline();
  }

  /** Call after pages were moved, inserted or deleted. */
  structureChanged(): void {
    this.thumbnails.structureChanged();
    this.reloadOutline();
  }

  private outlineSeq = 0;

  private reloadOutline(): void {
    const doc = this.doc;
    if (!doc) return;
    const seq = ++this.outlineSeq;
    doc
      .getOutline()
      .catch(() => [])
      .then((nodes) => {
        if (this.doc !== doc || seq !== this.outlineSeq) return;
        this.outline.setOutline(nodes);
        this.setOutlineAvailable(nodes.length > 0);
      });
  }

  /** Call after `PdfDocument.loadSizes` reported a batch. */
  sizesChanged(): void {
    this.thumbnails.sizesChanged();
  }

  /** False while the document has no outline (the Contents tab is disabled). */
  get outlineAvailable(): boolean {
    return !this.tabs.get('outline')!.disabled;
  }

  destroy(): void {
    for (const u of this.unsubscribers) u();
    this.thumbnails.destroy();
    this.outline.destroy();
    this.host.replaceChildren();
  }

  // ---- internals ----------------------------------------------------------

  /** Writes the tabs' and panels' text in the current UI language. */
  private relabel(): void {
    for (const { id, label } of TABS) this.tabs.get(id)!.textContent = t(label);
    this.labelOutlineTab();
    this.thumbnails.relabel();
    this.outline.relabel();
  }

  private labelOutlineTab(): void {
    const tab = this.tabs.get('outline')!;
    if (tab.disabled) tab.title = t('chrome.sidebar.noOutline');
    else tab.removeAttribute('title');
  }

  private setOutlineAvailable(available: boolean): void {
    this.tabs.get('outline')!.disabled = !available;
    this.labelOutlineTab();
    if (!available && this.store.get().sidebarTab === 'outline') this.store.set({ sidebarTab: 'thumbnails' });
  }

  private showTab(active: SidebarTab): void {
    for (const [id, tab] of this.tabs) {
      const on = id === active;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      this.panels.get(id)!.hidden = !on;
    }
    if (active === 'thumbnails') this.thumbnails.scrollCurrentIntoView();
  }
}
