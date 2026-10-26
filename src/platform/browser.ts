import type { DragState, Platform, Point } from './types';

/** Test hooks the Playwright suite drives through `window`. */
interface TestHooks {
  __pfwFiles: Map<string, Uint8Array>;
  __pfwNextSavePath: string | null;
  __pfwNextOpenPaths: string[] | null;
  __pfwExternalClipboard: string[] | null;
  __pfwRequestClose: () => Promise<boolean>;
}

/**
 * Browser shim used by the Playwright suite and `npm run dev` outside Tauri.
 * Paths are URLs relative to the page (e.g. `fixtures/simple.pdf`), `blob:<name>` keys for
 * files chosen through a file input or dropped, or keys of files written by `writeFile`.
 */
export function browserPlatform(): Platform {
  const hooks = window as unknown as TestHooks;
  hooks.__pfwFiles ??= new Map();
  hooks.__pfwNextSavePath ??= null;
  hooks.__pfwNextOpenPaths ??= null;
  hooks.__pfwExternalClipboard ??= null;
  const blobs = new Map<string, File>();
  const dropHandlers = new Set<(paths: string[], point: Point | null) => void>();
  const dragHandlers = new Set<(state: DragState) => void>();
  let closeHandler: (() => Promise<boolean>) | null = null;
  let dragDepth = 0;
  let clipboardSeq = 0;

  hooks.__pfwRequestClose = async () => (closeHandler ? closeHandler() : true);

  const register = (file: File): string => {
    const key = `blob:${file.name}`;
    blobs.set(key, file);
    return key;
  };
  const emitDrag = (state: DragState) => dragHandlers.forEach((h) => h(state));
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    emitDrag({ over: true, point: { x: e.clientX, y: e.clientY }, paths: [] });
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    emitDrag({ over: true, point: { x: e.clientX, y: e.clientY }, paths: [] });
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) {
      dragDepth = 0;
      emitDrag({ over: false, point: null, paths: [] });
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    emitDrag({ over: false, point: null, paths: [] });
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /\.pdf$/i.test(f.name));
    if (files.length === 0) return;
    const paths = files.map(register);
    const point = { x: e.clientX, y: e.clientY };
    dropHandlers.forEach((h) => h(paths, point));
  });

  const pickFiles = (multiple: boolean): Promise<string[]> =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,application/pdf';
      input.multiple = multiple;
      input.hidden = true;
      input.dataset['fileInput'] = '';
      document.body.append(input);
      const finish = (value: string[]) => {
        input.remove();
        resolve(value);
      };
      input.addEventListener('change', () => finish(Array.from(input.files ?? []).map(register)));
      input.addEventListener('cancel', () => finish([]));
      input.click();
    });

  return {
    async readFile(path) {
      const written = hooks.__pfwFiles.get(path);
      if (written) return written.slice();
      const file = blobs.get(path);
      if (file) return new Uint8Array(await file.arrayBuffer());
      const res = await fetch(encodeURI(path));
      if (!res.ok) throw new Error(`HTTP ${res.status} while reading ${path}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async openFileDialog() {
      const preset = hooks.__pfwNextOpenPaths;
      if (preset) {
        hooks.__pfwNextOpenPaths = null;
        return preset[0] ?? null;
      }
      return (await pickFiles(false))[0] ?? null;
    },
    async openFilesDialog() {
      const preset = hooks.__pfwNextOpenPaths;
      if (preset) {
        hooks.__pfwNextOpenPaths = null;
        return preset;
      }
      return pickFiles(true);
    },
    async saveFileDialog() {
      const next = hooks.__pfwNextSavePath;
      hooks.__pfwNextSavePath = null;
      return next;
    },
    async writeFile(path, data) {
      hooks.__pfwFiles.set(path, data.slice());
    },
    async openInNewWindow() {
      return false;
    },
    async clipboardWritePdf(data) {
      clipboardSeq++;
      hooks.__pfwFiles.set(`clipboard-${clipboardSeq}.pdf`, data.slice());
      hooks.__pfwExternalClipboard = null;
    },
    async clipboardReadPdfPaths() {
      return hooks.__pfwExternalClipboard;
    },
    async startupFile() {
      return new URLSearchParams(location.search).get('file');
    },
    onFileDrop(cb) {
      dropHandlers.add(cb);
      return () => dropHandlers.delete(cb);
    },
    onDragState(cb) {
      dragHandlers.add(cb);
      return () => dragHandlers.delete(cb);
    },
    onCloseRequested(cb) {
      closeHandler = cb;
    },
    async setTitle(title) {
      document.title = title;
    },
    fileName(path) {
      const p = path.startsWith('blob:') ? path.slice(5) : path;
      const last = p.split(/[\\/]/).pop() ?? p;
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    },
    windowControls: null,
    material: 'none',
  };
}
