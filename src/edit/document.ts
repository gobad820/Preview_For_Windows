import type { PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api';
import { PdfDocument, type OutlineNode, type PageText, type PdfAssets } from '../pdf/document';
import type { PageSource } from '../pdf/source';
import type { PageSize } from '../types';
import { fromSource, idSource, samePages, type Composition, type PageRef } from './composition';
import { History } from './history';
import { remapOutline } from './outlineRemap';
import { writePdf } from './writer';

export type ChangeKind = 'structure' | 'sizes';

export interface OpenOptions {
  password?: string | undefined;
  assets?: PdfAssets | undefined;
}

/**
 * A document assembled from pages of one or more PDFs. The opened file is source 0; merged
 * or pasted files are added as further sources and stay loaded for the window's lifetime so
 * every edit can be undone. Positions map to source pages through the current composition.
 */
export class EditableDocument implements PageSource {
  /** Allocates `PageRef.id`s; pass to composition helpers that insert pages. */
  readonly nextId = idSource();
  private readonly sources = new Map<number, PdfDocument>();
  private readonly outlines = new Map<number, Promise<OutlineNode[]>>();
  private readonly listeners = new Set<(kind: ChangeKind) => void>();
  private readonly history: History<Composition>;
  private nextSrc = 1;
  private currentSizes: PageSize[] = [];
  private destroyed = false;

  private constructor(
    primary: PdfDocument,
    private readonly assets: PdfAssets | undefined,
  ) {
    this.sources.set(0, primary);
    this.history = new History(fromSource(0, primary.numPages, this.nextId));
    this.refreshSizes();
  }

  static async open(data: Uint8Array, opts: OpenOptions = {}): Promise<EditableDocument> {
    const primary = await PdfDocument.load(data, { password: opts.password, assets: opts.assets });
    return new EditableDocument(primary, opts.assets);
  }

  // ---- composition and history ------------------------------------------------

  get pages(): Composition {
    return this.history.current;
  }

  get primary(): PdfDocument {
    return this.sources.get(0)!;
  }

  get numPages(): number {
    return this.pages.length;
  }

  get sizes(): PageSize[] {
    return this.currentSizes;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get dirty(): boolean {
    return this.history.dirty;
  }

  /** Makes `next` the current composition; false (and no history entry) when nothing changed. */
  apply(next: Composition): boolean {
    if (samePages(next, this.pages)) return false;
    this.history.push(next);
    this.structureChanged();
    return true;
  }

  undo(): boolean {
    if (!this.history.undo()) return false;
    this.structureChanged();
    return true;
  }

  redo(): boolean {
    if (!this.history.redo()) return false;
    this.structureChanged();
    return true;
  }

  markSaved(): void {
    this.history.markSaved();
  }

  onChange(cb: (kind: ChangeKind) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- sources --------------------------------------------------------------

  /** Loads another PDF (merge or paste) and its page sizes; returns its source id. */
  async addSource(data: Uint8Array, opts: { password?: string | undefined } = {}): Promise<number> {
    const doc = await PdfDocument.load(data, { password: opts.password, assets: this.assets });
    if (this.destroyed) {
      await doc.destroy();
      throw new Error('document closed');
    }
    await doc.loadSizes();
    const id = this.nextSrc++;
    this.sources.set(id, doc);
    return id;
  }

  sourcePageCount(src: number): number {
    return this.source(src).numPages;
  }

  /** Loads the remaining page sizes of the opened file; emits 'sizes' per batch. */
  async loadSizes(onBatch?: () => void): Promise<void> {
    await this.primary.loadSizes(() => {
      if (this.destroyed) return;
      this.refreshSizes();
      this.emit('sizes');
      onBatch?.();
    });
  }

  // ---- PageSource -----------------------------------------------------------

  getPage(index: number): Promise<PDFPageProxy> {
    const ref = this.ref(index);
    return this.source(ref.src).getPage(ref.index);
  }

  getTextContent(index: number): Promise<TextContent> {
    const ref = this.ref(index);
    return this.source(ref.src).getTextContent(ref.index);
  }

  getPageText(index: number): Promise<PageText> {
    const ref = this.ref(index);
    return this.source(ref.src).getPageText(ref.index);
  }

  pageKey(index: number): string {
    const ref = this.ref(index);
    return `${ref.src}:${ref.index}`;
  }

  /** Outline of every source in use, following pages to their current positions. */
  async getOutline(): Promise<OutlineNode[]> {
    const pages = this.pages;
    const used = [...new Set(pages.map((p) => p.src))];
    const outlines = await Promise.all(used.map(async (src) => ({ src, nodes: await this.rawOutline(src) })));
    return remapOutline(outlines, pages);
  }

  // ---- saving ---------------------------------------------------------------

  /** The current composition as a new PDF file. */
  async save(): Promise<Uint8Array> {
    const pages = this.pages;
    const used = [...new Set(pages.map((p) => p.src))];
    const sources = await Promise.all(
      used.map(async (id) => {
        const doc = this.source(id);
        return { id, bytes: await doc.getData(), password: doc.password };
      }),
    );
    const outline = await this.getOutline();
    return writePdf(sources, pages, { outline, metaFrom: used.includes(0) ? 0 : pages[0]!.src });
  }

  /** The given source pages as a standalone PDF (used for copying pages to other windows). */
  async extract(specs: ReadonlyArray<{ src: number; index: number }>): Promise<Uint8Array> {
    const used = [...new Set(specs.map((p) => p.src))];
    const sources = await Promise.all(
      used.map(async (id) => {
        const doc = this.source(id);
        return { id, bytes: await doc.getData(), password: doc.password };
      }),
    );
    return writePdf(sources, specs, { outline: [], metaFrom: specs[0]?.src });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await Promise.all([...this.sources.values()].map((d) => d.destroy()));
  }

  // ---- internals ------------------------------------------------------------

  private ref(index: number): PageRef {
    const ref = this.pages[index];
    if (!ref) throw new RangeError(`page ${index} out of range`);
    return ref;
  }

  private source(src: number): PdfDocument {
    const doc = this.sources.get(src);
    if (!doc) throw new Error(`unknown source ${src}`);
    return doc;
  }

  private rawOutline(src: number): Promise<OutlineNode[]> {
    let o = this.outlines.get(src);
    if (!o) {
      o = this.source(src).getOutline();
      this.outlines.set(src, o);
    }
    return o;
  }

  private structureChanged(): void {
    this.refreshSizes();
    this.emit('structure');
  }

  private refreshSizes(): void {
    this.currentSizes = this.pages.map((p) => this.source(p.src).sizes[p.index]!);
  }

  private emit(kind: ChangeKind): void {
    for (const l of this.listeners) l(kind);
  }
}
