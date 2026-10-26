import { PdfDocument, PdfOpenError } from './pdf/document';
import type { Platform } from './platform/types';
import { FindBar } from './search/findbar';
import { loadFileState } from './state/fileState';
import { createStore, initialState, type Store, type ViewerState } from './store';
import { PdfViewer } from './viewer/viewer';

export interface AppMetrics {
  openStart: number;
  firstPaint: number;
}

export class App {
  readonly store: Store<ViewerState> = createStore(initialState);
  readonly viewer: PdfViewer;
  readonly findBar: FindBar;
  readonly metrics: AppMetrics = { openStart: 0, firstPaint: 0 };
  private doc: PdfDocument | null = null;
  private openSeq = 0;

  constructor(
    private readonly platform: Platform,
    private readonly root: Document,
  ) {
    const appEl = this.el('app');
    const banner = this.el('.error-banner');
    const overlay = this.el('.drop-overlay');
    this.viewer = new PdfViewer(this.el('viewer'), this.store, {
      onFirstPaint: () => {
        if (!this.metrics.firstPaint) this.metrics.firstPaint = performance.now();
      },
    });

    this.store.select('status', (s) => {
      appEl.dataset['status'] = s;
    });
    this.store.select('error', (e) => {
      banner.hidden = !e;
      banner.textContent = e ?? '';
    });
    this.store.select('fileName', (name) => {
      void this.platform.setTitle(name ?? 'Preview');
    });
    banner.addEventListener('click', () => this.store.set({ error: null }));
    this.platform.onFileDrop((path) => void this.openPath(path));
    this.platform.onDragState((over) => {
      overlay.hidden = !over;
    });
    for (const b of root.querySelectorAll<HTMLElement>('[data-action="open"]')) {
      b.addEventListener('click', () => void this.open());
    }

    (window as unknown as { __pfw: unknown }).__pfw = {
      store: this.store,
      viewer: this.viewer,
      metrics: this.metrics,
    };

    // ---- find bar (Task 12) --------------------------------------------------
    this.findBar = new FindBar(this.el('findbar'), this.store, { viewer: this.viewer, doc: this.doc });
    (window as unknown as { __pfw: { findBar?: FindBar } }).__pfw.findBar = this.findBar;
    // ---- end find bar ----------------------------------------------------------
  }

  async start(): Promise<void> {
    const file = await this.platform.startupFile();
    if (file) await this.openPath(file);
  }

  async open(): Promise<void> {
    const path = await this.platform.openFileDialog();
    if (path) await this.openPath(path);
  }

  async openPath(path: string): Promise<void> {
    const seq = ++this.openSeq;
    this.metrics.openStart = performance.now();
    this.metrics.firstPaint = 0;
    this.store.set({ status: this.doc ? 'ready' : 'loading', error: null });
    try {
      const data = await this.platform.readFile(path);
      if (seq !== this.openSeq) return;
      await this.load(this.platform.fileName(path), data, path, seq);
    } catch (e) {
      if (seq === this.openSeq) this.fail(this.platform.fileName(path), e);
    }
  }

  async openBytes(name: string, data: Uint8Array): Promise<void> {
    const seq = ++this.openSeq;
    this.metrics.openStart = performance.now();
    this.metrics.firstPaint = 0;
    try {
      await this.load(name, data, null, seq);
    } catch (e) {
      if (seq === this.openSeq) this.fail(name, e);
    }
  }

  private async load(name: string, data: Uint8Array, path: string | null, seq: number): Promise<void> {
    const doc = await PdfDocument.load(data);
    if (seq !== this.openSeq) {
      void doc.destroy();
      return;
    }
    const old = this.doc;
    this.doc = doc;
    const restored = path ? loadFileState(path) : null;
    const s = this.store.get();
    this.store.set({
      filePath: path,
      fileName: name,
      numPages: doc.numPages,
      status: 'ready',
      error: null,
      zoomMode: restored?.zoomMode ?? s.zoomMode,
      scale: restored?.scale ?? s.scale,
      rotation: restored?.rotation ?? s.rotation,
      currentPage: 1,
    });
    await this.viewer.setDocument(doc);
    this.findBar.setDocument(doc); // find bar (Task 12)
    if (old) void old.destroy();
    if (restored && restored.page > 1) this.viewer.goToPage(restored.page - 1);
    void doc.loadSizes(() => {
      if (this.doc === doc) this.viewer.sizesChanged();
    });
  }

  private fail(name: string, e: unknown): void {
    const reason = e instanceof PdfOpenError ? e.message : e instanceof Error ? e.message : String(e);
    this.store.set({
      error: `Can't open ${name}: ${reason}`,
      status: this.doc ? 'ready' : 'error',
    });
  }

  private el<T extends HTMLElement = HTMLElement>(idOrSelector: string): T {
    const node = idOrSelector.startsWith('.')
      ? this.root.querySelector<T>(idOrSelector)
      : (this.root.getElementById(idOrSelector) as T | null);
    if (!node) throw new Error(`missing element ${idOrSelector}`);
    return node;
  }
}
