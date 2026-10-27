import * as pdfjs from 'pdfjs-dist';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
  TextItem,
} from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { hasOwnMarker } from '../annot/marker';
import { t } from '../i18n';
import type { PageSize } from '../types';
import type { PageSource } from './source';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

export type OpenErrorKind = 'password' | 'invalid' | 'unknown';

export class PdfOpenError extends Error {
  constructor(
    public readonly kind: OpenErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'PdfOpenError';
  }
}

export interface OutlineNode {
  title: string;
  /** 0-based page index, or null when the destination could not be resolved. */
  pageIndex: number | null;
  /** Offset from the page's top edge in PDF points, or null when unspecified. */
  top: number | null;
  /** Web address for entries that open a link instead of a page. */
  url?: string | null;
  children: OutlineNode[];
}

/** Where pdf.js finds its CMaps, standard fonts and wasm decoders. */
export interface PdfAssets {
  cMapUrl: string;
  standardFontDataUrl: string;
  wasmUrl: string;
}

export const BROWSER_ASSETS: PdfAssets = {
  cMapUrl: '/pdfjs/cmaps/',
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
};

export interface LoadOptions {
  password?: string | undefined;
  assets?: PdfAssets | undefined;
}

export type PageText = TextItem[];

const SIZE_BATCH = 25;

export class PdfDocument implements PageSource {
  readonly numPages: number;
  /** Unrotated page sizes in PDF points; entries default to page 1 until `loadSizes` fills them. */
  readonly sizes: PageSize[];

  private readonly pages = new Map<number, Promise<PDFPageProxy>>();
  private readonly contents = new Map<number, Promise<TextContent>>();
  private readonly texts = new Map<number, Promise<PageText>>();
  private destroyed = false;

  private constructor(
    private readonly task: PDFDocumentLoadingTask,
    private readonly proxy: PDFDocumentProxy,
    firstSize: PageSize,
    /** Password the document was opened with, needed again to re-read it for saving. */
    readonly password: string | undefined,
    /** The file contains annotations written by this app (found by a byte search, not parsed). */
    readonly ownMarker: boolean,
  ) {
    this.numPages = proxy.numPages;
    this.sizes = Array.from({ length: this.numPages }, () => ({ ...firstSize }));
  }

  static async load(data: Uint8Array, opts: LoadOptions = {}): Promise<PdfDocument> {
    const assets = opts.assets ?? BROWSER_ASSETS;
    // pdf.js transfers the buffer to its worker, so look for our annotations first.
    const ownMarker = hasOwnMarker(data);
    const task = pdfjs.getDocument({
      data,
      password: opts.password,
      cMapUrl: assets.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: assets.standardFontDataUrl,
      wasmUrl: assets.wasmUrl,
    });
    let proxy: PDFDocumentProxy;
    try {
      proxy = await task.promise;
    } catch (e) {
      throw toOpenError(e);
    }
    const first = await proxy.getPage(1);
    const doc = new PdfDocument(task, proxy, sizeOf(first), opts.password, ownMarker);
    doc.pages.set(0, Promise.resolve(first));
    return doc;
  }

  /** Page labels ("i", "ii", "1", …) or null when the document defines none. */
  async getPageLabels(): Promise<string[] | null> {
    try {
      return await this.proxy.getPageLabels();
    } catch {
      return null;
    }
  }

  /** Stops pdf.js from drawing these annotations (pdf.js ids, e.g. "12R"); overlays draw them instead. */
  hideAnnotations(ids: readonly string[]): void {
    for (const id of ids) this.proxy.annotationStorage.setValue(id, { noView: true });
  }

  /** Raw file bytes as pdf.js received them (still encrypted if the file was). */
  getData(): Promise<Uint8Array> {
    return this.proxy.getData();
  }

  pageKey(index: number): string {
    return `0:${index}`;
  }

  getPage(index: number): Promise<PDFPageProxy> {
    let p = this.pages.get(index);
    if (!p) {
      p = this.proxy.getPage(index + 1);
      this.pages.set(index, p);
    }
    return p;
  }

  /** Fetches the remaining page sizes in batches; `onBatch(from, to)` gets inclusive indices. */
  async loadSizes(onBatch: (from: number, to: number) => void = () => {}): Promise<void> {
    for (let from = 1; from < this.numPages; from += SIZE_BATCH) {
      if (this.destroyed) return;
      const to = Math.min(from + SIZE_BATCH, this.numPages) - 1;
      const pages = await Promise.all(
        Array.from({ length: to - from + 1 }, (_, i) => this.getPage(from + i)),
      );
      if (this.destroyed) return;
      pages.forEach((page, i) => {
        this.sizes[from + i] = sizeOf(page);
      });
      onBatch(from, to);
    }
  }

  async getOutline(): Promise<OutlineNode[]> {
    const raw = await this.proxy.getOutline();
    if (!raw) return [];
    const convert = async (items: typeof raw): Promise<OutlineNode[]> =>
      Promise.all(
        items.map(async (item) => {
          const target = await this.resolveDest(item.dest);
          return {
            title: item.title,
            pageIndex: target?.pageIndex ?? null,
            top: target?.top ?? null,
            url: item.url ?? null,
            children: await convert(item.items ?? []),
          };
        }),
      );
    return convert(raw);
  }

  /** Resolves a named or explicit destination to a page index and top offset. */
  async resolveDest(
    dest: string | unknown[] | null,
  ): Promise<{ pageIndex: number; top: number | null } | null> {
    try {
      const explicit = typeof dest === 'string' ? await this.proxy.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref = explicit[0];
      let pageIndex: number;
      if (typeof ref === 'number') pageIndex = ref;
      else if (ref && typeof ref === 'object' && 'num' in ref) {
        pageIndex = await this.proxy.getPageIndex(ref as { num: number; gen: number });
      } else return null;
      const kind = (explicit[1] as { name?: string } | undefined)?.name;
      let top: number | null = null;
      const y = kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : null;
      if (typeof y === 'number') {
        const page = await this.getPage(pageIndex);
        // page.view is [x0, y0, x1, y1] in PDF user space (y up); `top` is measured from the top edge.
        const [, y0, , y1] = page.view as [number, number, number, number];
        top = Math.max(0, Math.min(y1 - y0, y1 - y));
      }
      return { pageIndex, top };
    } catch {
      return null;
    }
  }

  /** Full pdf.js text content for a page (memoised); feeds both the text layer and search. */
  getTextContent(index: number): Promise<TextContent> {
    let c = this.contents.get(index);
    if (!c) {
      c = this.getPage(index).then((page) => page.getTextContent());
      this.contents.set(index, c);
    }
    return c;
  }

  /** Text items with a `str` (marked-content entries removed), in text layer order. */
  getPageText(index: number): Promise<PageText> {
    let t = this.texts.get(index);
    if (!t) {
      t = this.getTextContent(index).then((content) =>
        content.items.filter((i): i is TextItem => 'str' in i),
      );
      this.texts.set(index, t);
    }
    return t;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.task.destroy();
  }
}

function sizeOf(page: PDFPageProxy): PageSize {
  // getViewport honours the page's intrinsic /Rotate, so a landscape-rotated page reports as landscape.
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

function toOpenError(e: unknown): PdfOpenError {
  if (e instanceof pdfjs.PasswordException) {
    const incorrect = e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    return new PdfOpenError('password', t(incorrect ? 'dlg.error.incorrectPassword' : 'dlg.error.passwordProtected'));
  }
  if (e instanceof pdfjs.InvalidPDFException) {
    return new PdfOpenError('invalid', t('dlg.error.invalidPdf'));
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new PdfOpenError('unknown', msg || t('dlg.error.openFailed'));
}
