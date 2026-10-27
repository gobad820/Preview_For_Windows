import type { PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api';
import type { FontLoader } from '../annot/pdfWrite';
import { readOwnAnnotations } from '../annot/reader';
import type { Annot } from '../annot/types';
import { t } from '../i18n';
import { PdfDocument, type OutlineNode, type PageText, type PdfAssets } from '../pdf/document';
import type { PageSource } from '../pdf/source';
import type { PageSize } from '../types';
import {
  fromSource,
  idSource,
  sameOrder,
  samePages,
  setPageAnnots,
  type Composition,
  type PageRef,
  type PageSpec,
} from './composition';
import { History } from './history';
import { remapOutline } from './outlineRemap';
import { writePdf } from './writer';

export type ChangeKind = 'structure' | 'sizes' | 'annotations';

/** `positions` lists the pages whose annotations changed ('annotations' only). */
export type ChangeListener = (kind: ChangeKind, positions?: readonly number[]) => void;

const NO_ANNOTS: readonly Annot[] = Object.freeze([]);

export interface OpenOptions {
  password?: string | undefined;
  assets?: PdfAssets | undefined;
  /** Font for text box appearances when saving (Malgun Gothic). */
  font?: FontLoader | undefined;
}

/**
 * This app's annotations as they are in one source file. 'none': the file has none (no
 * parsing needed); 'pending': not read yet (pdf.js still draws them); 'ready': read, hidden
 * from pdf.js and drawn by overlays; 'failed': unreadable, so left to pdf.js and not editable.
 */
interface OwnState {
  status: 'none' | 'pending' | 'ready' | 'failed';
  pages: ReadonlyArray<readonly Annot[]>;
  /** Bumped once when the annotations become hidden from pdf.js. */
  generation: number;
  reading: Promise<void> | null;
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
  private readonly listeners = new Set<ChangeListener>();
  private readonly history: History<Composition>;
  private readonly own = new Map<number, OwnState>();
  private nextSrc = 1;
  private currentSizes: PageSize[] = [];
  private destroyed = false;

  private constructor(
    primary: PdfDocument,
    private readonly assets: PdfAssets | undefined,
    private readonly font: FontLoader | undefined,
  ) {
    this.sources.set(0, primary);
    this.own.set(0, ownState(primary));
    this.history = new History(fromSource(0, primary.numPages, this.nextId));
    this.refreshSizes();
  }

  static async open(data: Uint8Array, opts: OpenOptions = {}): Promise<EditableDocument> {
    const primary = await PdfDocument.load(data, { password: opts.password, assets: opts.assets });
    return new EditableDocument(primary, opts.assets, opts.font);
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

  /** Identifies the current composition; `save()` writes exactly this version. */
  get version(): number {
    return this.history.token;
  }

  /** Makes `next` the current composition; false (and no history entry) when nothing changed. */
  apply(next: Composition): boolean {
    const prev = this.pages;
    if (samePages(next, prev)) return false;
    this.history.push(next);
    this.changed(prev);
    return true;
  }

  undo(): boolean {
    const prev = this.pages;
    if (!this.history.undo()) return false;
    this.changed(prev);
    return true;
  }

  redo(): boolean {
    const prev = this.pages;
    if (!this.history.redo()) return false;
    this.changed(prev);
    return true;
  }

  /** Marks `version` (default: the current one) as what is on disk. */
  markSaved(version?: number): void {
    this.history.markSaved(version);
  }

  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- annotations ------------------------------------------------------------

  /** This app's annotations on the page at `index`; null while the file's own ones are not read yet. */
  annotationsAt(index: number): readonly Annot[] | null {
    const ref = this.pages[index];
    return ref ? this.annotationsOf(ref) : null;
  }

  /** Resolves with the page's annotations once they are known; rejects when the file's cannot be read. */
  async loadAnnotations(index: number): Promise<readonly Annot[]> {
    const ref = this.ref(index);
    if (ref.annots) return ref.annots;
    await this.readOwn(ref.src);
    // The page may have moved or been edited meanwhile; answer for the same page.
    const now = this.pages.find((p) => p.id === ref.id) ?? ref;
    const list = this.annotationsOf(now);
    if (!list) throw new Error(t('dlg.error.annotationsUnreadable'));
    return list;
  }

  /** Reads the annotations this app wrote into the open files (call once the first page is on screen). */
  async readAnnotations(): Promise<void> {
    await Promise.all([...this.own.keys()].map((src) => this.readOwn(src)));
  }

  /**
   * Replaces the annotations of several pages as one undo step; false when nothing changed or
   * when a page's own annotations are not known yet (`loadAnnotations` first), since a list
   * written without them would delete them on save.
   */
  updateAnnotations(changes: ReadonlyMap<number, readonly Annot[]>): boolean {
    for (const pos of changes.keys()) {
      const ref = this.pages[pos];
      if (ref && !ref.annots && this.annotationsOf(ref) === null) {
        console.warn(`page ${pos + 1}: annotations are not loaded yet; change ignored`);
        return false;
      }
    }
    return this.apply(setPageAnnots(this.pages, changes));
  }

  setAnnotations(index: number, list: readonly Annot[]): boolean {
    return this.updateAnnotations(new Map([[index, list]]));
  }

  /** Changes when the page's canvas must be re-rendered to hide annotations now drawn by an overlay. */
  hideGeneration(index: number): number {
    const ref = this.pages[index];
    return ref ? (this.own.get(ref.src)?.generation ?? 0) : 0;
  }

  newAnnotId(): string {
    return crypto.randomUUID();
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
    this.own.set(id, ownState(doc));
    void this.readOwn(id);
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
    const labels = new Map(await Promise.all(used.map(async (id) => [id, await this.source(id).getPageLabels()] as const)));
    const pageLabels = [...labels.values()].some((l) => l !== null)
      ? pages.map((p) => labels.get(p.src)?.[p.index] ?? null)
      : undefined;
    return writePdf(sources, pages, { outline, metaFrom: used.includes(0) ? 0 : pages[0]!.src, pageLabels, font: this.font });
  }

  /** The given source pages as a standalone PDF (used for copying pages to other windows). */
  async extract(specs: ReadonlyArray<PageSpec>): Promise<Uint8Array> {
    const used = [...new Set(specs.map((p) => p.src))];
    const sources = await Promise.all(
      used.map(async (id) => {
        const doc = this.source(id);
        return { id, bytes: await doc.getData(), password: doc.password };
      }),
    );
    return writePdf(sources, specs, { outline: [], metaFrom: specs[0]?.src, font: this.font });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await Promise.all([...this.sources.values()].map((d) => d.destroy()));
  }

  // ---- internals ------------------------------------------------------------

  private annotationsOf(ref: PageRef): readonly Annot[] | null {
    if (ref.annots) return ref.annots;
    const st = this.own.get(ref.src);
    if (!st || st.status === 'none') return NO_ANNOTS;
    return st.status === 'ready' ? (st.pages[ref.index] ?? NO_ANNOTS) : null;
  }

  /** Reads source `src`'s own annotations once, hides them from pdf.js and reports the pages. */
  private readOwn(src: number): Promise<void> {
    const st = this.own.get(src);
    if (!st || st.status !== 'pending') return st?.reading ?? Promise.resolve();
    st.reading ??= (async () => {
      const doc = this.source(src);
      try {
        const pages = await readOwnAnnotations(await doc.getData(), doc.password);
        if (this.destroyed) return;
        doc.hideAnnotations(pages.flatMap((list) => list.map((p) => p.ref)));
        st.pages = pages.map((list) => Object.freeze(list.map((p) => p.annot)));
        st.generation++;
        st.status = 'ready';
      } catch (e) {
        console.warn(`annotations of source ${src} could not be read`, e);
        st.status = 'failed';
        return;
      }
      const positions = this.pages.flatMap((p, i) => (p.src === src ? [i] : []));
      if (positions.length > 0) this.emit('annotations', positions);
    })();
    return st.reading;
  }

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

  /** Reports the step from `prev` to the current composition: annotations only, or structure. */
  private changed(prev: Composition): void {
    const next = this.pages;
    if (sameOrder(prev, next)) {
      const positions: number[] = [];
      next.forEach((p, i) => {
        if (p.annots !== prev[i]!.annots) positions.push(i);
      });
      this.emit('annotations', positions);
      return;
    }
    this.refreshSizes();
    this.emit('structure');
  }

  private refreshSizes(): void {
    this.currentSizes = this.pages.map((p) => this.source(p.src).sizes[p.index]!);
  }

  private emit(kind: ChangeKind, positions?: readonly number[]): void {
    for (const l of this.listeners) {
      if (positions) l(kind, positions);
      else l(kind);
    }
  }
}

function ownState(doc: PdfDocument): OwnState {
  return { status: doc.ownMarker ? 'pending' : 'none', pages: [], generation: 0, reading: null };
}
