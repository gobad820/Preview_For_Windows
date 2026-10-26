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
/** Text layers on screen, each with its end-of-content guard (see `bindSelection`). */
const layers = new Map<HTMLElement, HTMLElement>();
let listening = false;

/**
 * Port of pdf.js `TextLayerBuilder`'s selection guard: while a selection is being made, an
 * invisible `.endOfContent` block covers the empty parts of the layer so dragging across
 * whitespace does not make the selection jump to the end of the page.
 */
function bindSelection(host: HTMLElement): void {
  const end = document.createElement('div');
  end.className = 'endOfContent';
  host.append(end);
  layers.set(host, end);
  host.addEventListener('mousedown', () => host.classList.add('selecting'));
  if (listening) return;
  listening = true;
  let pointerDown = false;
  const resetAll = () => {
    for (const [layer, guard] of layers) {
      if (!layer.isConnected) {
        layers.delete(layer);
        continue;
      }
      layer.append(guard);
      layer.classList.remove('selecting');
    }
  };
  document.addEventListener('pointerdown', () => {
    pointerDown = true;
  });
  document.addEventListener('pointerup', () => {
    pointerDown = false;
    resetAll();
  });
  window.addEventListener('blur', () => {
    pointerDown = false;
    resetAll();
  });
  document.addEventListener('keyup', () => {
    if (!pointerDown) resetAll();
  });
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      resetAll();
      return;
    }
    const range = selection.getRangeAt(0);
    for (const [layer] of layers) {
      if (!layer.isConnected) {
        layers.delete(layer);
        continue;
      }
      layer.classList.toggle('selecting', range.intersectsNode(layer));
    }
  });
}

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
    .then(() => {
      if (cancelled) return [];
      bindSelection(host);
      return layer.textDivs;
    })
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
