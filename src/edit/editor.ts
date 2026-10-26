import type { Platform } from '../platform/types';
import type { Store, ViewerState } from '../store';
import { canDelete, deletePages, insertPages, movePages } from './composition';
import type { EditableDocument } from './document';
import { Selection } from './selection';

export interface EditorHost {
  doc(): EditableDocument | null;
  readonly platform: Platform;
  readonly store: Store<ViewerState>;
  goToPage(index: number): void;
  /** Loads the PDF at `path` as a new source of the current document (asking for a password if needed). */
  loadSource(path: string): Promise<number | null>;
  notify(message: string): void;
}

export interface Mods {
  ctrl: boolean;
  shift: boolean;
}

type PageSpec = { src: number; index: number };

/**
 * Page editing for the current document: thumbnail selection plus move, delete, copy, cut,
 * paste, merge, undo and redo. Positions are 0-based page positions; the selection is kept by
 * page id so it survives moves.
 */
export class Editor {
  readonly selection = new Selection();
  private readonly listeners = new Set<() => void>();
  private clipboard: PageSpec[] | null = null;
  private busy = false;

  constructor(private readonly host: EditorHost) {
    host.store.select('currentPage', (page) => this.followCurrentPage(page));
  }

  // ---- selection ------------------------------------------------------------

  onSelectionChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  idAt(index: number): number | undefined {
    return this.host.doc()?.pages[index]?.id;
  }

  isSelectedAt(index: number): boolean {
    const id = this.idAt(index);
    return id !== undefined && this.selection.has(id);
  }

  selectedPositions(): number[] {
    const pages = this.host.doc()?.pages ?? [];
    const out: number[] = [];
    pages.forEach((p, i) => {
      if (this.selection.has(p.id)) out.push(i);
    });
    return out;
  }

  /** Thumbnail click: plain selects one page and shows it; Ctrl toggles; Shift selects a range. */
  clickAt(index: number, mods: Mods): void {
    const id = this.idAt(index);
    if (id === undefined) return;
    this.selection.click(id, this.order(), mods);
    this.emit();
    if (!mods.ctrl && !mods.shift) this.host.goToPage(index);
  }

  selectAll(): void {
    this.selection.selectAll(this.order());
    this.emit();
  }

  /** Arrow keys in the sidebar. */
  step(dir: 1 | -1, extend: boolean): void {
    const id = this.selection.step(dir, this.order(), extend);
    this.emit();
    if (id !== null) this.host.goToPage(this.positionOf(id));
  }

  /** Call after the document's structure changed (any source: edit, undo, redo). */
  structureChanged(): void {
    this.selection.prune(this.order());
    this.emit();
  }

  /** New document: empty clipboard stays (it can be pasted elsewhere), selection resets. */
  documentChanged(): void {
    this.selection.clear();
    this.clipboard = null;
    const page = this.host.store.get().currentPage;
    if (page > 0) this.followCurrentPage(page);
    this.emit();
  }

  // ---- structural edits -------------------------------------------------------

  /** Moves the selected pages into `gap` (0 = before the first page). */
  moveSelectionTo(gap: number): boolean {
    const doc = this.host.doc();
    if (!doc || this.selection.size === 0) return false;
    if (!doc.apply(movePages(doc.pages, this.selection.ids, gap))) return false;
    this.showFirstSelected();
    return true;
  }

  deleteSelection(): boolean {
    const doc = this.host.doc();
    if (!doc || this.selection.size === 0) return false;
    if (!canDelete(doc.pages, this.selection.ids)) {
      this.host.notify('A document needs at least one page.');
      return false;
    }
    const first = this.selectedPositions()[0] ?? 0;
    if (!doc.apply(deletePages(doc.pages, this.selection.ids))) return false;
    const next = Math.min(first, doc.numPages - 1);
    this.selection.selectOnly(doc.pages[next]!.id);
    this.emit();
    this.host.goToPage(next);
    return true;
  }

  /** Copies the selected pages; other windows can paste them through the system clipboard. */
  async copySelection(): Promise<void> {
    const doc = this.host.doc();
    if (!doc || this.selection.size === 0) return;
    const specs = this.selectedPositions().map((i) => ({ src: doc.pages[i]!.src, index: doc.pages[i]!.index }));
    this.clipboard = specs;
    try {
      await this.host.platform.clipboardWritePdf(await doc.extract(specs));
    } catch (e) {
      // In-window paste still works from the in-memory copy.
      console.warn('could not put pages on the system clipboard', e);
    }
  }

  async cutSelection(): Promise<void> {
    const doc = this.host.doc();
    if (!doc || this.selection.size === 0) return;
    if (!canDelete(doc.pages, this.selection.ids)) {
      this.host.notify('A document needs at least one page.');
      return;
    }
    await this.copySelection();
    this.deleteSelection();
  }

  /** Inserts copied pages after the selection (or the current page) and selects them. */
  async paste(): Promise<void> {
    const doc = this.host.doc();
    if (!doc || this.busy) return;
    this.busy = true;
    try {
      const gap = this.insertionGap();
      const external = await this.host.platform.clipboardReadPdfPaths();
      if (external === null) {
        if (this.clipboard && this.clipboard.length > 0) this.insertSpecs(this.clipboard, gap);
        return;
      }
      if (external.length > 0) await this.insertFilesAt(external, gap);
    } finally {
      this.busy = false;
    }
  }

  /** Merges PDF files into the document at `gap` (default: after the selection). */
  async insertFiles(paths: string[], gap?: number): Promise<void> {
    if (!this.host.doc() || this.busy || paths.length === 0) return;
    this.busy = true;
    try {
      await this.insertFilesAt(paths, gap ?? this.insertionGap());
    } finally {
      this.busy = false;
    }
  }

  undo(): void {
    this.host.doc()?.undo();
  }

  redo(): void {
    this.host.doc()?.redo();
  }

  // ---- internals ------------------------------------------------------------

  private async insertFilesAt(paths: string[], gap: number): Promise<void> {
    const doc = this.host.doc();
    if (!doc) return;
    const specs: PageSpec[] = [];
    for (const path of paths) {
      const src = await this.host.loadSource(path);
      if (src === null || this.host.doc() !== doc) continue;
      for (let i = 0; i < doc.sourcePageCount(src); i++) specs.push({ src, index: i });
    }
    if (specs.length > 0 && this.host.doc() === doc) this.insertSpecs(specs, Math.min(gap, doc.numPages));
  }

  private insertSpecs(specs: PageSpec[], gap: number): void {
    const doc = this.host.doc();
    if (!doc) return;
    const { pages, ids } = insertPages(doc.pages, gap, specs, doc.nextId);
    if (!doc.apply(pages)) return;
    this.selection.set(ids);
    this.emit();
    this.showFirstSelected();
  }

  private insertionGap(): number {
    const selected = this.selectedPositions();
    if (selected.length > 0) return selected[selected.length - 1]! + 1;
    return Math.max(0, this.host.store.get().currentPage);
  }

  private showFirstSelected(): void {
    const first = this.selectedPositions()[0];
    if (first !== undefined) this.host.goToPage(first);
  }

  /** While at most one page is selected, the selection follows the page shown in the viewer. */
  private followCurrentPage(page: number): void {
    if (this.selection.size > 1) return;
    const id = this.idAt(page - 1);
    if (id === undefined || this.selection.has(id)) return;
    this.selection.selectOnly(id);
    this.emit();
  }

  private order(): number[] {
    return (this.host.doc()?.pages ?? []).map((p) => p.id);
  }

  private positionOf(id: number): number {
    return (this.host.doc()?.pages ?? []).findIndex((p) => p.id === id);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
