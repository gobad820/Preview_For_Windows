import * as pdfjs from 'pdfjs-dist';
import type { RenderTask } from 'pdfjs-dist/types/src/display/api';
import type { Rotation } from '../types';
import type { PdfDocument } from './document';

/** CSS pixels per PDF point at 100% (pdf.js convention: 96 dpi / 72 dpi). */
export const CSS_UNITS = 96 / 72;

/**
 * Upper bound on canvas backing-store pixels per page. Beyond this the bitmap is rendered
 * smaller and CSS upscales it, so 800% on a HiDPI screen cannot allocate hundreds of MB.
 */
export const MAX_CANVAS_PIXELS = 2 ** 24;

export interface RenderRequest {
  index: number;
  scale: number;
  rotation: Rotation;
  canvas: HTMLCanvasElement;
  dpr: number;
}

export interface RenderHandle {
  /** Resolves when the render finished or was cancelled; rejects only on real errors. */
  done: Promise<void>;
  cancel(): void;
}

interface Entry {
  task: RenderTask | null;
  cancelled: boolean;
}

/** Renders pages into canvases; at most one in-flight render per page index. */
export class PageRenderer {
  private readonly inflight = new Map<number, Entry>();

  constructor(private readonly doc: PdfDocument) {}

  render(req: RenderRequest): RenderHandle {
    this.cancel(req.index);
    const entry: Entry = { task: null, cancelled: false };
    this.inflight.set(req.index, entry);

    const done = (async () => {
      try {
        const page = await this.doc.getPage(req.index);
        if (entry.cancelled) return;
        const rotation = ((page.rotate + req.rotation) % 360) as Rotation;
        let viewport = page.getViewport({ scale: req.scale * CSS_UNITS * req.dpr, rotation });
        const pixels = viewport.width * viewport.height;
        if (pixels > MAX_CANVAS_PIXELS) {
          const factor = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
          viewport = page.getViewport({ scale: req.scale * CSS_UNITS * req.dpr * factor, rotation });
        }
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        const { canvas } = req;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const canvasContext = canvas.getContext('2d', { alpha: false });
        if (!canvasContext) return;
        const task = page.render({ canvas, canvasContext, viewport });
        entry.task = task;
        await task.promise;
      } catch (e) {
        if (entry.cancelled || e instanceof pdfjs.RenderingCancelledException) return;
        throw e;
      } finally {
        if (this.inflight.get(req.index) === entry) this.inflight.delete(req.index);
      }
    })();

    return {
      done,
      cancel: () => {
        entry.cancelled = true;
        entry.task?.cancel();
      },
    };
  }

  cancel(index: number): void {
    const prev = this.inflight.get(index);
    if (prev) {
      prev.cancelled = true;
      prev.task?.cancel();
      this.inflight.delete(index);
    }
  }

  cancelAll(): void {
    for (const index of [...this.inflight.keys()]) this.cancel(index);
  }
}
