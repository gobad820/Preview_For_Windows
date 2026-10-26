import { AbortException, TextLayer } from 'pdfjs-dist';
import type { PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';

export interface TextLayerHandle {
  /** Resolves to the text divs (one per text item with a `str`), or `[]` when cancelled. */
  done: Promise<HTMLElement[]>;
  cancel(): void;
}

/**
 * Mounts a pdf.js text layer into `host`, which must be absolutely positioned over the page
 * canvas. `viewport` is the CSS-pixel viewport (no device pixel ratio). The caller must set
 * `--scale-factor` to `viewport.scale` on `host` or an ancestor; this sets it on `host`.
 *
 * Invariant verified against pdfjs-dist 6.4 (`TextLayer.#processItems`): `textDivs[i]`
 * corresponds to the i-th text content item whose `str` is defined; marked-content items
 * produce no div. `PdfDocument.getPageText` applies the same filter.
 */
export function mountTextLayer(
  _page: PDFPageProxy,
  textContent: TextContent,
  viewport: PageViewport,
  host: HTMLElement,
): TextLayerHandle {
  host.replaceChildren();
  host.style.setProperty('--scale-factor', String(viewport.scale));
  const layer = new TextLayer({ textContentSource: textContent, container: host, viewport });
  let cancelled = false;
  const done = layer
    .render()
    .then(() => (cancelled ? [] : layer.textDivs))
    .catch((e: unknown) => {
      if (cancelled || e instanceof AbortException) return [];
      throw e;
    });
  return {
    done,
    cancel: () => {
      cancelled = true;
      layer.cancel();
    },
  };
}
