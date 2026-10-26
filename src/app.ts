import { PdfDocument, PdfOpenError } from './pdf/document';
import { PageRenderer } from './pdf/renderer';
import type { Platform } from './platform/types';
import { FindBar } from './search/findbar';
import { Sidebar } from './sidebar/sidebar';
import { bindShortcuts, type Action } from './shortcuts';
import { loadFileState, saveFileState } from './state/fileState';
import { createStore, initialState, type Store, type ViewerState } from './store';
import { Toolbar } from './toolbar/toolbar';
import type { Rotation } from './types';
import { PdfViewer } from './viewer/viewer';
import { zoomIn, zoomOut } from './viewer/zoom';

/** Horizontal pan per arrow-key press when the page is wider than the viewport (CSS px). */
const PAN_STEP = 80;

export interface AppMetrics {
  openStart: number;
  firstPaint: number;
}

export class App {
  readonly store: Store<ViewerState> = createStore(initialState);
  readonly viewer: PdfViewer;
  readonly toolbar: Toolbar;
  readonly sidebar: Sidebar;
  readonly findBar: FindBar;
  readonly metrics: AppMetrics = { openStart: 0, firstPaint: 0 };
  private doc: PdfDocument | null = null;
  private openSeq = 0;
  private saveTimer = 0;
  /** File waiting for a password after a PasswordException. */
  private pendingPassword: { path: string; name: string } | null = null;
  private readonly passwordForm: HTMLFormElement;
  private readonly passwordInput: HTMLInputElement;
  private readonly passwordMessage: HTMLElement;

  constructor(
    private readonly platform: Platform,
    private readonly root: Document,
  ) {
    const appEl = this.el('app');
    const banner = this.el('.error-banner');
    const overlay = this.el('.drop-overlay');
    this.passwordForm = this.el<HTMLFormElement>('.password-panel');
    this.passwordInput = this.el<HTMLInputElement>('[data-password-input]');
    this.passwordMessage = this.el('[data-password-message]');
    this.passwordForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitPassword();
    });
    this.el('[data-password-cancel]').addEventListener('click', () => this.cancelPassword());
    this.passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelPassword();
      }
    });
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
    for (const b of root.querySelectorAll<HTMLElement>('.empty-state [data-action="open"]')) {
      b.addEventListener('click', () => void this.open());
    }

    // ---- toolbar ----
    this.toolbar = new Toolbar(this.el('toolbar'), this.store, {
      toggleSidebar: () => this.store.set({ sidebarOpen: !this.store.get().sidebarOpen }),
      gotoPage: (page) => this.viewer.goToPage(page - 1),
      zoomIn: () => this.viewer.setZoom('custom', zoomIn(this.store.get().scale)),
      zoomOut: () => this.viewer.setZoom('custom', zoomOut(this.store.get().scale)),
      setZoom: (mode, scale) => this.viewer.setZoom(mode, scale),
      rotate: () => this.rotate(90),
      toggleFind: () => this.findBar.toggle(),
      open: () => void this.open(),
    });

    // ---- shortcuts + per-file state ----
    bindShortcuts(window, (action) => this.dispatch(action));
    this.store.subscribe((s, prev) => {
      if (
        s.status === 'ready' &&
        s.filePath &&
        (s.currentPage !== prev.currentPage ||
          s.scale !== prev.scale ||
          s.zoomMode !== prev.zoomMode ||
          s.rotation !== prev.rotation)
      ) {
        this.scheduleSave();
      }
    });
    window.addEventListener('pagehide', () => this.flushSave());
    window.addEventListener('beforeunload', () => this.flushSave());

    (window as unknown as { __pfw: unknown }).__pfw = {
      app: this,
      store: this.store,
      viewer: this.viewer,
      toolbar: this.toolbar,
      metrics: this.metrics,
    };

    // ---- sidebar wiring (Task 11) ----------------------------------------
    const aside = this.el('sidebar');
    this.sidebar = new Sidebar(aside, this.store, {
      doc: null,
      renderer: null,
      goToPage: (index, top) => this.viewer.goToPage(index, top),
    });
    this.store.select('sidebarOpen', (open) => {
      aside.hidden = !open;
    });
    Object.assign((window as unknown as { __pfw: object }).__pfw, { sidebar: this.sidebar });
    // ---- end sidebar wiring ----------------------------------------------
    // ---- find bar (Task 12) --------------------------------------------------
    this.findBar = new FindBar(this.el('findbar'), this.store, { viewer: this.viewer, doc: this.doc });
    (window as unknown as { __pfw: { findBar?: FindBar } }).__pfw.findBar = this.findBar;
    // ---- end find bar ----------------------------------------------------------
  }

  /** Routes a resolved keyboard shortcut to the matching behaviour. */
  dispatch(action: Action): void {
    const s = this.store.get();
    const hasDoc = s.status === 'ready' && s.numPages > 0;
    switch (action) {
      case 'open':
        void this.open();
        return;
      case 'find':
        if (hasDoc) this.findBar.open();
        return;
      case 'close-find':
        if (s.findOpen) this.findBar.close();
        return;
      case 'find-next':
      case 'find-prev':
        return; // handled by the find bar's own input listener
      case 'toggle-sidebar':
        this.store.set({ sidebarOpen: !s.sidebarOpen });
        return;
      default:
        break;
    }
    if (!hasDoc) return;
    switch (action) {
      case 'zoom-in':
        this.viewer.setZoom('custom', zoomIn(s.scale));
        break;
      case 'zoom-out':
        this.viewer.setZoom('custom', zoomOut(s.scale));
        break;
      case 'zoom-100':
        this.viewer.setZoom('custom', 1);
        break;
      case 'fit-width':
      case 'fit-page':
        this.viewer.setZoom(action);
        break;
      case 'rotate-cw':
        this.rotate(90);
        break;
      case 'rotate-ccw':
        this.rotate(-90);
        break;
      case 'goto-page':
        this.toolbar.focusPageInput();
        break;
      case 'next-page':
        if (this.viewer.overflowsHorizontally()) this.viewer.panBy(PAN_STEP);
        else this.viewer.goToPage(s.currentPage);
        break;
      case 'prev-page':
        if (this.viewer.overflowsHorizontally()) this.viewer.panBy(-PAN_STEP);
        else this.viewer.goToPage(s.currentPage - 2);
        break;
      case 'first-page':
        this.viewer.goToPage(0);
        break;
      case 'last-page':
        this.viewer.goToPage(s.numPages - 1);
        break;
      case 'scroll-down':
        this.viewer.scrollByViewport(1);
        break;
      case 'scroll-up':
        this.viewer.scrollByViewport(-1);
        break;
    }
  }

  async start(): Promise<void> {
    const file = await this.platform.startupFile();
    if (file) await this.openPath(file);
  }

  rotate(delta: 90 | -90): void {
    const next = (((this.store.get().rotation + delta) % 360) + 360) % 360;
    this.viewer.setRotation(next as Rotation);
  }

  async open(): Promise<void> {
    const path = await this.platform.openFileDialog();
    if (path) await this.openPath(path);
  }

  async openPath(path: string, password?: string): Promise<void> {
    const seq = ++this.openSeq;
    this.metrics.openStart = performance.now();
    this.metrics.firstPaint = 0;
    if (!password) this.hidePasswordPanel();
    this.store.set({ status: this.doc ? 'ready' : 'loading', error: null });
    try {
      // pdf.js transfers the buffer to its worker, so a password retry re-reads the file.
      const data = await this.platform.readFile(path);
      if (seq !== this.openSeq) return;
      await this.load(this.platform.fileName(path), data, path, seq, password);
    } catch (e) {
      if (seq === this.openSeq) this.fail(this.platform.fileName(path), e, path);
    }
  }

  private async load(
    name: string,
    data: Uint8Array,
    path: string | null,
    seq: number,
    password?: string,
  ): Promise<void> {
    const doc = await PdfDocument.load(data, { password });
    if (seq !== this.openSeq) {
      void doc.destroy();
      return;
    }
    this.hidePasswordPanel();
    const old = this.doc;
    this.doc = doc;
    const restored = path ? loadFileState(path) : null;
    this.flushSave();
    this.store.set({
      filePath: path,
      fileName: name,
      numPages: doc.numPages,
      status: 'ready',
      error: null,
      // A file without saved state starts from the defaults, not the previous document's view.
      zoomMode: restored?.zoomMode ?? initialState.zoomMode,
      scale: restored?.scale ?? initialState.scale,
      rotation: restored?.rotation ?? initialState.rotation,
      currentPage: 1,
      findOpen: false,
    });
    await this.viewer.setDocument(doc);
    this.sidebar.setDocument(doc, new PageRenderer(doc)); // sidebar (Task 11)
    this.findBar.setDocument(doc); // find bar (Task 12)
    if (old) void old.destroy();
    if (restored && restored.page > 1) this.viewer.goToPage(restored.page - 1);
    void doc.loadSizes(() => {
      if (this.doc !== doc) return;
      this.viewer.sizesChanged();
      this.sidebar.sizesChanged();
    });
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 300);
  }

  private flushSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const s = this.store.get();
    if (s.status !== 'ready' || !s.filePath || s.currentPage < 1) return;
    saveFileState(s.filePath, {
      page: s.currentPage,
      zoomMode: s.zoomMode,
      scale: s.scale,
      rotation: s.rotation,
    });
  }

  private fail(name: string, e: unknown, path?: string): void {
    const reason = e instanceof PdfOpenError ? e.message : e instanceof Error ? e.message : String(e);
    if (e instanceof PdfOpenError && e.kind === 'password' && path) {
      this.pendingPassword = { path, name };
      this.store.set({ error: null, status: this.doc ? 'ready' : 'error' });
      this.showPasswordPanel(reason.toLowerCase().includes('incorrect') ? 'Incorrect password. Try again.' : '');
      return;
    }
    this.store.set({
      error: `Can't open ${name}: ${reason}`,
      status: this.doc ? 'ready' : 'error',
    });
    if (!this.doc) this.sidebar.setDocument(null, null); // sidebar (Task 11)
  }

  private showPasswordPanel(message: string): void {
    this.passwordMessage.textContent = message;
    this.passwordForm.hidden = false;
    this.passwordInput.value = '';
    this.passwordInput.focus();
  }

  private hidePasswordPanel(): void {
    this.pendingPassword = null;
    this.passwordForm.hidden = true;
    this.passwordMessage.textContent = '';
  }

  private submitPassword(): void {
    const pending = this.pendingPassword;
    const password = this.passwordInput.value;
    if (!pending || !password) return;
    void this.openPath(pending.path, password);
  }

  private cancelPassword(): void {
    this.hidePasswordPanel();
    this.el('viewer').focus();
  }

  private el<T extends HTMLElement = HTMLElement>(idOrSelector: string): T {
    const node = /^[A-Za-z][\w-]*$/.test(idOrSelector)
      ? (this.root.getElementById(idOrSelector) as T | null)
      : this.root.querySelector<T>(idOrSelector);
    if (!node) throw new Error(`missing element ${idOrSelector}`);
    return node;
  }
}
