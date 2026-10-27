import { EditableDocument, type ChangeKind } from './edit/document';
import { Editor } from './edit/editor';
import { PdfOpenError } from './pdf/document';
import { PageRenderer } from './pdf/renderer';
import type { Platform, Point } from './platform/types';
import { FindBar } from './search/findbar';
import { Sidebar } from './sidebar/sidebar';
import { bindShortcuts, type Action } from './shortcuts';
import { loadFileState, saveFileState } from './state/fileState';
import { loadPrefs, savePrefs } from './state/prefs';
import { createStore, initialState, type DisplayMode, type SidebarTab, type Store, type ViewerState } from './store';
import { Toolbar } from './toolbar/toolbar';
import type { Rotation } from './types';
import type { DocPoint } from './viewer/layout';
import { showAbout } from './ui/about';
import { showAlert } from './ui/dialog';
import { showMenu, type MenuItem } from './ui/menu';
import { PdfViewer } from './viewer/viewer';
import { zoomIn, zoomOut } from './viewer/zoom';
import type { Composition } from './edit/composition';
import { MarkupBar, openHighlightMenu } from './markup/bar';
import { OverlayHost } from './markup/overlay';
import { MarkupController } from './markup/controller';
import { MarkupState, type MarkKind, type Styles } from './markup/state';
import type { Color } from './annot/types';
import { Commands } from './commands';
import { MenuBar } from './menubar/menubar';
import { MENUS } from './menubar/menus';
import { showShortcuts } from './menubar/shortcutsPanel';
import type { Tool } from './markup/state';

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
  readonly editor: Editor;
  /** Markup tool and default styles for this window. */
  readonly markup = new MarkupState();
  /** Every feature by id; the menu bar and other menus are built from these. */
  readonly commands = new Commands();
  /** The in-window menu bar (File, Edit, View, …) built from `commands`. */
  readonly menuBar: MenuBar;
  readonly markupBar: MarkupBar;
  /** Annotation drawing over document pages and thumbnails. */
  readonly overlays: OverlayHost;
  /** Markup tools, editing and the selected annotation in the document view. */
  readonly markupController: MarkupController;
  readonly metrics: AppMetrics = { openStart: 0, firstPaint: 0 };
  private doc: EditableDocument | null = null;
  /** Composition before the latest change, to keep the viewer on the same page across edits. */
  private lastPages: Composition = [];
  private openSeq = 0;
  private saveTimer = 0;
  /** Saves run one after another; each starts when the previous one has finished. */
  private saveQueue: Promise<unknown> = Promise.resolve();
  /** Size and modification time of the open file when it was read or last written. */
  private fileStamp: string | null = null;
  /** The close prompt that is showing, so repeated close requests share it. */
  private closing: Promise<boolean> | null = null;
  private readonly overlay: HTMLElement;
  /** Runs once the first page of the document being opened is on screen. */
  private afterFirstPaint: (() => void) | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly root: Document,
  ) {
    const appEl = this.el('app');
    const banner = this.el('.error-banner');
    this.overlay = this.el('.drop-overlay');
    this.viewer = new PdfViewer(this.el('viewer'), this.store, {
      onFirstPaint: () => {
        if (!this.metrics.firstPaint) this.metrics.firstPaint = performance.now();
        const then = this.afterFirstPaint;
        this.afterFirstPaint = null;
        then?.();
      },
    });

    // ---- page layout (Continuous Scroll / Two Pages): a window-wide preference ----
    this.store.set(loadPrefs());
    this.store.subscribe((s, prev) => {
      if (s.displayMode !== prev.displayMode || s.bookMode !== prev.bookMode) {
        this.viewer.setDisplay(s.displayMode, s.bookMode);
        savePrefs({ displayMode: s.displayMode, bookMode: s.bookMode });
      }
    });
    this.viewer.setDisplay(this.store.get().displayMode, this.store.get().bookMode);

    this.store.select('status', (s) => {
      appEl.dataset['status'] = s;
    });
    this.store.select('error', (e) => {
      banner.hidden = !e;
      banner.textContent = e ?? '';
    });
    this.store.subscribe((s, prev) => {
      if (s.fileName !== prev.fileName || s.dirty !== prev.dirty) this.updateTitle();
    });
    this.updateTitle();
    banner.addEventListener('click', () => this.store.set({ error: null }));
    this.platform.onFileDrop((paths, point) => void this.onDrop(paths, point));
    this.platform.onDragState((state) => {
      const overList = !!(this.doc && state.over && state.point && this.sidebar.thumbnails.containsPoint(state.point));
      this.overlay.hidden = !state.over || overList;
      if (overList && state.point) {
        this.sidebar.thumbnails.autoScrollFor(state.point);
        this.sidebar.thumbnails.showIndicator(this.sidebar.thumbnails.gapAt(state.point.y));
      } else {
        this.sidebar.thumbnails.showIndicator(null);
      }
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
      moreMenu: (anchor) => this.moreMenu(anchor),
      toggleMarkup: () => this.store.set({ markupOpen: !this.store.get().markupOpen }),
      highlight: () => this.highlightButton(),
      highlightMenu: (anchor) =>
        openHighlightMenu(anchor, root.querySelector('#toolbar [data-action="highlight-menu"]'), this.markup, (kind, color) =>
          this.pickMark(kind, color),
        ),
      viewMenu: (anchor) => this.viewMenu(anchor),
    }, this.platform.windowControls);
    const markupBar = this.el('markupbar');
    this.markupBar = new MarkupBar(markupBar, this.markup, {
      highlight: () => this.highlightButton(),
      pickMark: (kind, color) => this.pickMark(kind, color),
      applyStyles: (patch) => this.applyStyles(patch),
    });
    this.store.select('markupOpen', (open) => {
      markupBar.hidden = !open;
      // Hiding the markup toolbar puts its tools away, like Preview.
      if (!open) this.markup.setTool('select');
    });
    const syncHighlight = () => {
      const { styles, highlightMode } = this.markup;
      this.toolbar.setHighlight({ on: highlightMode, color: styles.markColor, kind: styles.markKind });
    };
    this.markup.onChange(syncHighlight);
    syncHighlight();

    // ---- page editing ----
    this.editor = new Editor({
      doc: () => this.doc,
      platform: this.platform,
      store: this.store,
      goToPage: (index) => this.viewer.goToPage(index),
      loadSource: (path) => this.loadSource(path),
      notify: (message) => this.store.set({ error: message }),
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
    this.platform.onCloseRequested(() => this.confirmClose());

    // ---- sidebar ----
    const aside = this.el('sidebar');
    this.sidebar = new Sidebar(aside, this.store, {
      doc: null,
      renderer: null,
      goToPage: (index, top) => this.viewer.goToPage(index, top),
      editor: this.editor,
      contextMenu: (point) => this.pageContextMenu(point),
    });
    this.store.select('sidebarOpen', (open) => {
      aside.hidden = !open;
    });

    this.overlays = new OverlayHost(() => this.doc, [this.viewer, this.sidebar.thumbnails]);
    this.markupController = new MarkupController({
      doc: () => this.doc,
      viewer: this.viewer,
      container: this.el('viewer'),
      state: this.markup,
      store: this.store,
      overlays: this.overlays,
      notify: (message) => this.store.set({ error: message }),
    });

    // ---- find bar ----
    this.findBar = new FindBar(this.el('findbar'), this.store, { viewer: this.viewer, doc: null });

    // ---- menu bar ----
    this.menuBar = new MenuBar(this.el('menubar'), this.commands, this.store);

    (window as unknown as { __pfw: unknown }).__pfw = {
      app: this,
      store: this.store,
      viewer: this.viewer,
      toolbar: this.toolbar,
      sidebar: this.sidebar,
      findBar: this.findBar,
      editor: this.editor,
      metrics: this.metrics,
      markup: { state: this.markup, overlays: this.overlays, controller: this.markupController },
      menuBar: this.menuBar,
    };
    (window as unknown as { __pfwUi: unknown }).__pfwUi = { showMenu, showAlert };
    this.registerCommands();
  }

  /** A document is open and ready. */
  private hasDocument(): boolean {
    const s = this.store.get();
    return s.status === 'ready' && s.numPages > 0 && this.doc !== null;
  }

  /** Settings (Ctrl+,). The preferences window replaces this. */
  openPreferences(): void {}

  /** Registers every feature as a command (see src/commands.ts). */
  private registerCommands(): void {
    const has = () => this.hasDocument();
    const st = () => this.store.get();
    const act = (a: Action) => () => this.dispatch(a);
    const tool = (id: string, label: string, t: Tool) => ({
      id,
      label,
      radio: true,
      enabled: has,
      checked: () => st().markupOpen && this.markup.tool === t,
      run: () => {
        // Tools work on the markup toolbar's state; showing it keeps the tool armed.
        this.store.set({ markupOpen: true });
        this.markup.setTool(t);
      },
    });
    const controls = this.platform.windowControls;
    this.commands.register(
      // Preview
      { id: 'app.about', label: 'About Preview', run: () => showAbout() },
      { id: 'app.preferences', label: 'Settings…', shortcut: 'Ctrl+,', run: () => this.openPreferences() },
      // File
      { id: 'file.open', label: 'Open…', shortcut: 'Ctrl+O', run: act('open') },
      { id: 'file.insertPages', label: 'Insert Pages from File…', enabled: has, run: () => void this.insertPagesFromFile() },
      { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', enabled: has, run: act('save') },
      { id: 'file.saveAs', label: 'Save As…', shortcut: 'Ctrl+Shift+S', enabled: has, run: act('save-as') },
      { id: 'file.print', label: 'Print…', shortcut: 'Ctrl+P', enabled: has, run: () => window.print() },
      { id: 'file.close', label: 'Close Window', shortcut: 'Ctrl+W', run: act('close-window') },
      // Edit
      { id: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z', enabled: () => has() && !!this.doc?.canUndo, run: act('undo') },
      { id: 'edit.redo', label: 'Redo', shortcut: 'Ctrl+Y', enabled: () => has() && !!this.doc?.canRedo, run: act('redo') },
      { id: 'edit.cut', label: 'Cut', shortcut: 'Ctrl+X', enabled: () => has() && this.editor.selection.size > 0, run: () => void this.editor.cutSelection() },
      {
        id: 'edit.copy',
        label: 'Copy',
        shortcut: 'Ctrl+C',
        enabled: has,
        // Selected text is copied as text; otherwise the selected pages.
        run: () => {
          if (!(window.getSelection()?.isCollapsed ?? true)) document.execCommand('copy');
          else void this.editor.copySelection();
        },
      },
      { id: 'edit.paste', label: 'Paste', shortcut: 'Ctrl+V', enabled: has, run: () => void this.editor.paste() },
      {
        id: 'edit.delete',
        label: 'Delete',
        shortcut: 'Delete',
        enabled: has,
        // The selected annotation, otherwise the selected pages.
        run: () => {
          if (!this.markupController.deleteSelected()) this.editor.deleteSelection();
        },
      },
      {
        id: 'edit.duplicate',
        label: 'Duplicate',
        shortcut: 'Ctrl+D',
        enabled: () => has() && this.markupController.selected !== null,
        run: () => void this.markupController.duplicateSelected(),
      },
      { id: 'edit.selectAll', label: 'Select All Pages', shortcut: 'Ctrl+A', enabled: has, run: () => this.editor.selectAll() },
      { id: 'edit.find', label: 'Find…', shortcut: 'Ctrl+F', enabled: has, run: act('find') },
      // View
      {
        id: 'view.sidebar',
        label: () => (st().sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'),
        shortcut: 'Ctrl+Alt+S',
        run: act('toggle-sidebar'),
      },
      {
        id: 'view.thumbnails',
        label: 'Thumbnails',
        radio: true,
        checked: () => st().sidebarOpen && st().sidebarTab === 'thumbnails',
        run: () => this.store.set({ sidebarOpen: true, sidebarTab: 'thumbnails' }),
      },
      {
        id: 'view.outline',
        label: 'Table of Contents',
        radio: true,
        enabled: () => this.sidebar.outlineAvailable,
        checked: () => st().sidebarOpen && st().sidebarTab === 'outline',
        run: () => this.store.set({ sidebarOpen: true, sidebarTab: 'outline' }),
      },
      {
        id: 'view.continuous',
        label: 'Continuous Scroll',
        radio: true,
        checked: () => st().displayMode === 'continuous',
        run: () => this.store.set({ displayMode: 'continuous' }),
      },
      {
        id: 'view.twoPages',
        label: 'Two Pages',
        radio: true,
        checked: () => st().displayMode === 'two-pages',
        run: () => this.store.set({ displayMode: 'two-pages' }),
      },
      {
        id: 'view.bookMode',
        label: 'Book Mode',
        enabled: () => st().displayMode === 'two-pages',
        checked: () => st().bookMode,
        run: () => this.store.set({ bookMode: !st().bookMode }),
      },
      { id: 'view.actualSize', label: 'Actual Size', shortcut: 'Ctrl+0', enabled: has, run: act('zoom-100') },
      { id: 'view.zoomIn', label: 'Zoom In', shortcut: 'Ctrl+=', enabled: has, run: act('zoom-in') },
      { id: 'view.zoomOut', label: 'Zoom Out', shortcut: 'Ctrl+-', enabled: has, run: act('zoom-out') },
      { id: 'view.fitWidth', label: 'Fit Width', shortcut: 'Ctrl+1', radio: true, enabled: has, checked: () => st().zoomMode === 'fit-width', run: act('fit-width') },
      { id: 'view.fitPage', label: 'Fit Page', shortcut: 'Ctrl+2', radio: true, enabled: has, checked: () => st().zoomMode === 'fit-page', run: act('fit-page') },
      { id: 'view.rotateLeft', label: 'Rotate Left', shortcut: 'Ctrl+Shift+L', enabled: has, run: act('rotate-ccw') },
      { id: 'view.rotateRight', label: 'Rotate Right', shortcut: 'Ctrl+L', enabled: has, run: act('rotate-cw') },
      {
        id: 'view.markupToolbar',
        label: () => (st().markupOpen ? 'Hide Markup Toolbar' : 'Show Markup Toolbar'),
        shortcut: 'Ctrl+Shift+A',
        enabled: has,
        run: act('toggle-markup'),
      },
      {
        id: 'view.menuBar',
        label: 'Menu Bar',
        checked: () => st().menuBarVisible,
        run: () => this.store.set({ menuBarVisible: !st().menuBarVisible }),
      },
      // Go
      { id: 'go.next', label: 'Next Page', shortcut: '→', enabled: has, run: () => this.viewer.stepPage(1) },
      { id: 'go.previous', label: 'Previous Page', shortcut: '←', enabled: has, run: () => this.viewer.stepPage(-1) },
      { id: 'go.first', label: 'First Page', shortcut: 'Home', enabled: has, run: act('first-page') },
      { id: 'go.last', label: 'Last Page', shortcut: 'End', enabled: has, run: act('last-page') },
      { id: 'go.page', label: 'Go to Page…', shortcut: 'Ctrl+G', enabled: has, run: act('goto-page') },
      // Tools (markup)
      tool('tools.select', 'Text Selection', 'select'),
      {
        id: 'tools.highlight',
        label: 'Highlight',
        enabled: has,
        checked: () => this.markup.highlightMode,
        run: () => this.highlightButton(),
      },
      { id: 'tools.underline', label: 'Underline', enabled: has, run: () => this.pickMark('underline') },
      { id: 'tools.strikeout', label: 'Strikethrough', enabled: has, run: () => this.pickMark('strikeout') },
      tool('tools.draw', 'Draw', 'draw'),
      tool('tools.line', 'Line', 'line'),
      tool('tools.arrow', 'Arrow', 'arrow'),
      tool('tools.rect', 'Rectangle', 'rect'),
      tool('tools.rounded', 'Rounded Rectangle', 'rounded'),
      tool('tools.oval', 'Oval', 'oval'),
      tool('tools.text', 'Text', 'text'),
      tool('tools.note', 'Note', 'note'),
      // Window
      { id: 'window.minimize', label: 'Minimize', enabled: () => !!controls, run: () => void controls?.minimize() },
      { id: 'window.zoom', label: 'Zoom', enabled: () => !!controls, run: () => void controls?.toggleMaximize() },
      // Help
      { id: 'help.shortcuts', label: 'Keyboard Shortcuts', run: () => showShortcuts(MENUS, this.commands) },
    );
  }

  /** The document being edited, if any. */
  get document(): EditableDocument | null {
    return this.doc;
  }

  /** Routes a resolved keyboard shortcut to the matching behaviour. */
  dispatch(action: Action): void {
    const s = this.store.get();
    const hasDoc = s.status === 'ready' && s.numPages > 0 && this.doc !== null;
    switch (action) {
      case 'open':
        void this.open();
        return;
      case 'find':
        if (hasDoc) this.findBar.open();
        return;
      case 'close-find':
        if (this.markupEscape()) return;
        if (s.findOpen) this.findBar.close();
        return;
      case 'find-next':
      case 'find-prev':
        return; // handled by the find bar's own input listener
      case 'toggle-sidebar':
        this.store.set({ sidebarOpen: !s.sidebarOpen });
        return;
      case 'close-window':
        void this.platform.windowControls?.close();
        return;
      default:
        break;
    }
    if (!hasDoc) return;
    switch (action) {
      case 'save':
        void this.save();
        break;
      case 'save-as':
        void this.saveAs();
        break;
      case 'undo':
        this.editor.undo();
        break;
      case 'redo':
        this.editor.redo();
        break;
      case 'select-all-pages':
        this.editor.selectAll();
        break;
      case 'copy-pages':
        void this.editor.copySelection();
        break;
      case 'cut-pages':
        void this.editor.cutSelection();
        break;
      case 'paste-pages':
        void this.editor.paste();
        break;
      case 'delete-pages':
        this.editor.deleteSelection();
        break;
      case 'toggle-markup':
        this.store.set({ markupOpen: !s.markupOpen });
        break;
      case 'delete-annotation':
        this.markupController.deleteSelected();
        break;
      case 'duplicate-annotation':
        this.markupController.duplicateSelected();
        break;
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
        else this.viewer.stepPage(1);
        break;
      case 'prev-page':
        if (this.viewer.overflowsHorizontally()) this.viewer.panBy(-PAN_STEP);
        else this.viewer.stepPage(-1);
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
    if (path) await this.openOrSpawn(path);
  }

  /** Like Preview: an empty window loads the file; a window with a document opens a new one. */
  async openOrSpawn(path: string): Promise<void> {
    if (this.doc) {
      let spawned = false;
      try {
        spawned = await this.platform.openInNewWindow(path);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.store.set({ error: `Can't open ${this.platform.fileName(path)} in a new window: ${reason}` });
        return;
      }
      if (spawned) return;
    }
    if (this.doc && !(await this.confirmDiscard())) return;
    await this.openPath(path);
  }

  /** Opens `path` in this window, asking for a password when the file needs one. */
  async openPath(path: string, password?: string): Promise<void> {
    const seq = ++this.openSeq;
    this.metrics.openStart = performance.now();
    this.metrics.firstPaint = 0;
    const name = this.platform.fileName(path);
    this.store.set({ status: this.doc ? 'ready' : 'loading', error: null });
    try {
      // pdf.js transfers the buffer to its worker, so a password retry re-reads the file.
      const stamp = await this.platform.fileStamp(path).catch(() => null);
      const data = await this.platform.readFile(path);
      if (seq !== this.openSeq) return;
      await this.load(name, data, path, seq, password);
      if (seq === this.openSeq) this.fileStamp = stamp;
    } catch (e) {
      if (seq !== this.openSeq) return;
      if (e instanceof PdfOpenError && e.kind === 'password') {
        this.store.set({ error: null, status: this.doc ? 'ready' : 'error' });
        const retry = await this.askPassword(name, password !== undefined);
        if (retry !== null && seq === this.openSeq) await this.openPath(path, retry);
        return;
      }
      this.fail(name, e);
    }
  }

  // ---- saving ---------------------------------------------------------------

  /** Ctrl+S: writes over the opened file. Nothing happens when there is nothing to save. */
  save(): Promise<boolean> {
    this.markupController.commitEditing();
    return this.queueSave(async () => {
      // Edits waiting for a page's annotations to be read belong in this save.
      await this.markupController.settle();
      return this.saveNow();
    });
  }

  /** Ctrl+Shift+S: writes a copy and keeps editing the copy. */
  saveAs(): Promise<boolean> {
    this.markupController.commitEditing();
    return this.queueSave(async () => {
      await this.markupController.settle();
      return this.saveAsNow();
    });
  }

  private queueSave(job: () => Promise<boolean>): Promise<boolean> {
    const run = this.saveQueue.then(job, job);
    this.saveQueue = run.catch(() => false);
    return run;
  }

  private async saveNow(): Promise<boolean> {
    const doc = this.doc;
    const path = this.store.get().filePath;
    if (!doc) return false;
    if (!path) return this.saveAsNow();
    // Rewriting an unedited file could only lose what this editor does not keep (forms, tags).
    if (!doc.dirty) return true;
    const changed = await this.changedOnDisk(path);
    if (changed) {
      const choice = await this.askChangedOnDisk(this.platform.fileName(path));
      if (choice === 'cancel') return false;
      if (choice === 'save-as') return this.saveAsNow();
    }
    return this.writeTo(path);
  }

  private async saveAsNow(): Promise<boolean> {
    if (!this.doc) return false;
    const s = this.store.get();
    const suggested = s.filePath ?? s.fileName ?? 'Untitled.pdf';
    let path = await this.platform.saveFileDialog(suggested);
    if (!path) return false;
    if (!/\.pdf$/i.test(path)) path += '.pdf';
    if (!(await this.writeTo(path))) return false;
    this.store.set({ filePath: path, fileName: this.platform.fileName(path) });
    this.flushSave();
    return true;
  }

  /** Writes the document as it is right now; later edits stay marked as unsaved. */
  private async writeTo(path: string): Promise<boolean> {
    const doc = this.doc;
    if (!doc) return false;
    const name = this.platform.fileName(path);
    const version = doc.version;
    try {
      const bytes = await doc.save();
      await this.platform.writeFile(path, bytes);
      if (this.doc === doc) {
        doc.markSaved(version);
        this.fileStamp = await this.platform.fileStamp(path);
        this.store.set({ dirty: doc.dirty, error: null });
      }
      return true;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.store.set({ error: `Couldn't save ${name}: ${reason}` });
      return false;
    }
  }

  /** True when the file on disk is no longer the one this window read or last wrote. */
  private async changedOnDisk(path: string): Promise<boolean> {
    if (this.fileStamp === null) return false;
    const now = await this.platform.fileStamp(path).catch(() => null);
    return now !== null && now !== this.fileStamp;
  }

  private async askChangedOnDisk(name: string): Promise<'save-as' | 'overwrite' | 'cancel'> {
    const { value } = await showAlert({
      title: `“${name}” has been changed by another application.`,
      message: 'Saving now would replace those changes. You can save your version as a new file instead.',
      buttons: [
        { label: 'Save As…', value: 'save-as', primary: true },
        { label: 'Replace', value: 'overwrite' },
        { label: 'Cancel', value: 'cancel', cancel: true },
      ],
    });
    return value === 'save-as' || value === 'overwrite' ? value : 'cancel';
  }

  /** Before the window closes: true when it may close. Repeated requests share one prompt. */
  private confirmClose(): Promise<boolean> {
    this.closing ??= (async () => {
      try {
        this.flushSave();
        await this.saveQueue; // a save in flight finishes before deciding
        return await this.confirmDiscard();
      } finally {
        this.closing = null;
      }
    })();
    return this.closing;
  }

  /**
   * Unsaved changes would be lost: ask Save / Don't Save / Cancel. Resolves true when the
   * caller may proceed (saved or discarded).
   */
  async confirmDiscard(): Promise<boolean> {
    // Text still in an open text box or note editor, or waiting for a page's annotations, counts as an edit.
    await this.markupController.settle();
    if (!this.doc?.dirty) return true;
    const choice = await this.askUnsaved(this.store.get().fileName ?? 'Untitled');
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    return this.save();
  }

  private async askUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'> {
    const { value } = await showAlert({
      title: `Do you want to save the changes made to the document “${name}”?`,
      message: "Your changes will be lost if you don't save them.",
      buttons: [
        { label: 'Save', value: 'save', primary: true },
        { label: "Don't Save", value: 'discard' },
        { label: 'Cancel', value: 'cancel', cancel: true },
      ],
    });
    return value === 'save' || value === 'discard' ? value : 'cancel';
  }

  // ---- markup -----------------------------------------------------------------

  /** Esc ends editing, disarms a tool or deselects before it closes find; true when it did one. */
  private markupEscape(): boolean {
    return this.markupController.handleEscape();
  }

  /** The highlight button's main part: marks selected text and turns highlight mode on, or toggles the mode. */
  private highlightButton(): void {
    if (this.markupController.markSelection()) this.markup.setHighlightMode(true);
    else this.markup.setHighlightMode(!this.markup.highlightMode);
  }

  /** A color or kind picked from a highlight menu becomes the mark style and restyles selected markup, or turns highlight mode on and marks selected text. */
  private pickMark(kind: MarkKind, color?: Color): void {
    this.markup.setMark(kind, color);
    // With text markup selected, the pick restyles it; otherwise it arms highlight mode.
    if (this.markupController.restyleSelectedMark(kind, color)) return;
    this.markup.setHighlightMode(true);
    this.markupController.markSelection();
  }

  private applyStyles(patch: Partial<Styles>): void {
    this.markupController.applyStyles(patch);
  }

  /** Right-click on a thumbnail. */
  private pageContextMenu(point: Point): void {
    const has = this.editor.selection.size > 0;
    void showMenu(point, [
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !has, action: () => void this.editor.cutSelection() },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !has, action: () => void this.editor.copySelection() },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => void this.editor.paste() },
      { label: 'Delete', shortcut: 'Delete', disabled: !has, action: () => this.editor.deleteSelection() },
      'separator',
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => this.editor.selectAll() },
      'separator',
      { label: 'Insert Pages from File…', action: () => void this.insertPagesFromFile() },
    ]);
  }

  /** The toolbar's ⋯ menu: file and edit commands. */
  moreMenu(anchor: DOMRect): void {
    const doc = this.doc;
    void showMenu(anchor, [
      { label: 'Open…', shortcut: 'Ctrl+O', action: () => void this.open() },
      'separator',
      { label: 'Save', shortcut: 'Ctrl+S', disabled: !doc, action: () => void this.save() },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: !doc, action: () => void this.saveAs() },
      'separator',
      { label: 'Insert Pages from File…', disabled: !doc, action: () => void this.insertPagesFromFile() },
      'separator',
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !doc?.canUndo, action: () => this.editor.undo() },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !doc?.canRedo, action: () => this.editor.redo() },
      'separator',
      { label: 'About Preview', action: () => showAbout() },
    ]);
  }

  /** The View menu (the chevron by the sidebar button): sidebar and page layout, as in Preview. */
  viewMenu(anchor: DOMRect): void {
    const s = this.store.get();
    const sidebar = (tab: SidebarTab): MenuItem => ({
      label: tab === 'thumbnails' ? 'Thumbnails' : 'Table of Contents',
      radio: true,
      checked: s.sidebarOpen && s.sidebarTab === tab,
      disabled: tab === 'outline' && !this.sidebar.outlineAvailable,
      action: () => this.store.set({ sidebarOpen: true, sidebarTab: tab }),
    });
    const display = (mode: DisplayMode): MenuItem => ({
      label: mode === 'continuous' ? 'Continuous Scroll' : 'Two Pages',
      radio: true,
      checked: s.displayMode === mode,
      action: () => this.store.set({ displayMode: mode }),
    });
    // The toolbar anchors the menu on the sidebar button; the press-to-close area covers the chevron too.
    const chevron = this.root.querySelector('[data-action="view-menu"]')?.getBoundingClientRect();
    const at = chevron
      ? new DOMRect(
          anchor.left,
          anchor.top,
          Math.max(anchor.right, chevron.right) - anchor.left,
          Math.max(anchor.bottom, chevron.bottom) - anchor.top,
        )
      : anchor;
    this.toolbar.setViewMenuOpen(true);
    void showMenu(at, [
      {
        label: s.sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
        shortcut: 'Ctrl+Alt+S',
        action: () => this.store.set({ sidebarOpen: !this.store.get().sidebarOpen }),
      },
      sidebar('thumbnails'),
      sidebar('outline'),
      'separator',
      display('continuous'),
      display('two-pages'),
      {
        label: 'Book Mode',
        checked: s.bookMode,
        disabled: s.displayMode !== 'two-pages',
        action: () => this.store.set({ bookMode: !this.store.get().bookMode }),
      },
    ]).then(() => this.toolbar.setViewMenuOpen(false));
  }

  /** Picks PDFs and merges them after the selection. */
  async insertPagesFromFile(): Promise<void> {
    if (!this.doc) return;
    const paths = await this.platform.openFilesDialog();
    if (paths.length > 0) await this.editor.insertFiles(paths);
  }

  // ---- merging ----------------------------------------------------------------

  private async onDrop(paths: string[], point: Point | null): Promise<void> {
    this.sidebar.thumbnails.showIndicator(null);
    this.overlay.hidden = true;
    if (this.doc && point && this.sidebar.thumbnails.containsPoint(point)) {
      await this.editor.insertFiles(paths, this.sidebar.thumbnails.gapAt(point.y));
      return;
    }
    for (const path of paths) await this.openOrSpawn(path);
  }

  /** Adds the PDF at `path` to the current document as a new source; null when skipped. */
  private async loadSource(path: string): Promise<number | null> {
    const doc = this.doc;
    if (!doc) return null;
    const name = this.platform.fileName(path);
    let password: string | undefined;
    for (;;) {
      try {
        const data = await this.platform.readFile(path);
        return await doc.addSource(data, { password });
      } catch (e) {
        if (e instanceof PdfOpenError && e.kind === 'password') {
          const answer = await this.askPassword(name, password !== undefined);
          if (answer === null) return null;
          password = answer;
          continue;
        }
        const reason = e instanceof Error ? e.message : String(e);
        this.store.set({ error: `Can't add ${name}: ${reason}` });
        return null;
      }
    }
  }

  // ---- document lifecycle ---------------------------------------------------

  private async load(
    name: string,
    data: Uint8Array,
    path: string | null,
    seq: number,
    password?: string,
  ): Promise<void> {
    const doc = await EditableDocument.open(data, { password, font: () => this.platform.loadAnnotationFont() });
    if (seq !== this.openSeq) {
      void doc.destroy();
      return;
    }
    const old = this.doc;
    this.markupController.reset();
    this.doc = doc;
    this.lastPages = doc.pages;
    doc.onChange((kind) => this.onDocChange(doc, kind));
    const restored = path ? loadFileState(path) : null;
    this.flushSave();
    this.store.set({
      filePath: path,
      fileName: name,
      numPages: doc.numPages,
      status: 'ready',
      error: null,
      dirty: false,
      // A file without saved state starts from the defaults, not the previous document's view.
      zoomMode: restored?.zoomMode ?? initialState.zoomMode,
      scale: restored?.scale ?? initialState.scale,
      rotation: restored?.rotation ?? initialState.rotation,
      currentPage: 1,
      findOpen: false,
    });
    await this.viewer.setDocument(doc);
    this.sidebar.setDocument(doc, new PageRenderer(doc));
    this.findBar.setDocument(doc);
    this.editor.documentChanged();
    if (old) void old.destroy();
    if (restored && restored.page > 1) this.viewer.goToPage(restored.page - 1);
    void doc.loadSizes();
    // Annotations this app wrote are read (only files that have them parse at all) after the
    // first page is on screen, so they never delay it; pdf.js draws them until then.
    const read = () => {
      if (this.doc === doc) void doc.readAnnotations();
    };
    if (this.metrics.firstPaint) read();
    else {
      this.afterFirstPaint = read;
      window.setTimeout(read, 2000);
    }
  }

  private onDocChange(doc: EditableDocument, kind: ChangeKind): void {
    if (this.doc !== doc) return;
    if (kind === 'sizes') {
      this.viewer.sizesChanged();
      this.sidebar.sizesChanged();
      return;
    }
    if (kind === 'annotations') {
      this.lastPages = doc.pages;
      this.viewer.annotationsChanged();
      this.sidebar.thumbnails.annotationsChanged();
      this.overlays.refresh();
      this.markupController.documentChanged();
      this.store.set({ dirty: doc.dirty });
      return;
    }
    const anchor = this.anchorAfterChange(this.lastPages, doc.pages);
    this.lastPages = doc.pages;
    this.findBar.structureChanged();
    this.viewer.structureChanged(anchor, 'center');
    this.sidebar.structureChanged();
    this.editor.structureChanged();
    this.overlays.refresh();
    this.markupController.documentChanged();
    this.store.set({ numPages: doc.numPages, dirty: doc.dirty });
  }

  /** Keeps the page in the middle of the view in view; if it was deleted, the next surviving page. */
  private anchorAfterChange(prev: Composition, next: Composition): DocPoint {
    const top = this.viewer.centerAnchor();
    const positions = new Map(next.map((p, i) => [p.id, i]));
    const kept = prev[top.index] ? positions.get(prev[top.index]!.id) : undefined;
    if (kept !== undefined) return { index: kept, fraction: top.fraction };
    for (let i = Math.max(0, top.index); i < prev.length; i++) {
      const j = positions.get(prev[i]!.id);
      if (j !== undefined) return { index: j, fraction: 0 };
    }
    return { index: Math.max(0, next.length - 1), fraction: 0 };
  }

  private updateTitle(): void {
    const s = this.store.get();
    const name = s.fileName ?? 'Preview';
    void this.platform.setTitle(s.dirty ? `${name} — Edited` : name);
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

  private fail(name: string, e: unknown): void {
    const reason = e instanceof PdfOpenError ? e.message : e instanceof Error ? e.message : String(e);
    this.store.set({
      error: `Can't open ${name}: ${reason}`,
      status: this.doc ? 'ready' : 'error',
    });
    if (!this.doc) this.sidebar.setDocument(null, null);
  }

  // ---- password prompt --------------------------------------------------------

  /** Asks for `name`'s password in a modal alert; resolves with it, or null when cancelled. */
  private async askPassword(name: string, retry: boolean): Promise<string | null> {
    const { value, input } = await showAlert({
      title: `“${name}” is password protected.`,
      message: retry ? 'Incorrect password. Try again.' : 'Enter the password to open it.',
      input: { type: 'password', placeholder: 'Password' },
      buttons: [
        { label: 'Open', value: 'open', primary: true },
        { label: 'Cancel', value: 'cancel', cancel: true },
      ],
    });
    if (value !== 'open' || !input) {
      this.el('viewer').focus();
      return null;
    }
    return input;
  }

  private el<T extends HTMLElement = HTMLElement>(idOrSelector: string): T {
    const node = /^[A-Za-z][\w-]*$/.test(idOrSelector)
      ? (this.root.getElementById(idOrSelector) as T | null)
      : this.root.querySelector<T>(idOrSelector);
    if (!node) throw new Error(`missing element ${idOrSelector}`);
    return node;
  }
}
