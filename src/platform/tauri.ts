import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { DragState, Platform, Point, WindowControls } from './types';

export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

const isPdf = (p: string) => /\.pdf$/i.test(p);
const PDF_FILTER = [{ name: 'PDF Document', extensions: ['pdf'] }];

/** Tauri reports physical pixels relative to the webview; the page works in CSS pixels. */
const toCss = (p: { x: number; y: number }): Point => {
  const dpr = window.devicePixelRatio || 1;
  return { x: p.x / dpr, y: p.y / dpr };
};

function windowControls(): WindowControls {
  const win = getCurrentWindow();
  return {
    minimize: () => win.minimize(),
    toggleMaximize: () => win.toggleMaximize(),
    close: () => win.close(),
    isMaximized: () => win.isMaximized(),
    onMaximizedChange(cb) {
      let last: boolean | null = null;
      let disposed = false;
      const check = async () => {
        const now = await win.isMaximized();
        if (!disposed && now !== last) {
          last = now;
          cb(now);
        }
      };
      void check();
      const unlisten = win.onResized(() => void check());
      return () => {
        disposed = true;
        void unlisten.then((u) => u());
      };
    },
  };
}

/** Platform backed by the Tauri shell: native file I/O, dialogs, OS drag-and-drop, window. */
export function tauriPlatform(material: 'mica' | 'none' = 'none'): Platform {
  const dropHandlers = new Set<(paths: string[], point: Point | null) => void>();
  const dragHandlers = new Set<(state: DragState) => void>();
  let dragPaths: string[] = [];
  const emitDrag = (state: DragState) => dragHandlers.forEach((h) => h(state));

  void getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === 'enter') {
      dragPaths = p.paths.filter(isPdf);
      emitDrag({ over: dragPaths.length > 0, point: toCss(p.position), paths: dragPaths });
    } else if (p.type === 'over') {
      if (dragPaths.length > 0) emitDrag({ over: true, point: toCss(p.position), paths: dragPaths });
    } else if (p.type === 'leave') {
      dragPaths = [];
      emitDrag({ over: false, point: null, paths: [] });
    } else if (p.type === 'drop') {
      dragPaths = [];
      emitDrag({ over: false, point: null, paths: [] });
      const paths = p.paths.filter(isPdf);
      const point = toCss(p.position);
      if (paths.length > 0) dropHandlers.forEach((h) => h(paths, point));
    }
  });

  let annotationFont: Promise<Uint8Array | null> | null = null;

  return {
    loadAnnotationFont() {
      // Malgun Gothic ships with every Windows 10/11 and allows editable embedding. A failed
      // read is not remembered, so the next save tries again.
      annotationFont ??= invoke<ArrayBuffer>('system_font', { name: 'malgun.ttf' }).then(
        (buf) => new Uint8Array(buf),
        (e: unknown) => {
          console.warn('Malgun Gothic could not be read', e);
          annotationFont = null;
          return null;
        },
      );
      return annotationFont;
    },
    async readFile(path) {
      const buf = await invoke<ArrayBuffer>('read_file', { path });
      return new Uint8Array(buf);
    },
    async openFileDialog() {
      const result = await open({ multiple: false, directory: false, filters: PDF_FILTER });
      if (typeof result === 'string') return result;
      if (Array.isArray(result)) return (result[0] as string | undefined) ?? null;
      return null;
    },
    async openFilesDialog() {
      const result = await open({ multiple: true, directory: false, filters: PDF_FILTER });
      if (Array.isArray(result)) return result as string[];
      return typeof result === 'string' ? [result] : [];
    },
    async saveFileDialog(defaultPath) {
      return (await save({ defaultPath, filters: PDF_FILTER })) ?? null;
    },
    async writeFile(path, data) {
      await invoke('write_file', data, { headers: { 'x-path': encodeURIComponent(path) } });
    },
    fileStamp(path) {
      return invoke<string | null>('file_stamp', { path });
    },
    async openInNewWindow(path) {
      await invoke('open_window', { path });
      return true;
    },
    async clipboardWritePdf(data) {
      await invoke('clipboard_write_pdf', data);
    },
    clipboardReadPdfPaths() {
      return invoke<string[] | null>('clipboard_read_pdf_paths');
    },
    startupFile() {
      return invoke<string | null>('startup_file');
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
      const win = getCurrentWindow();
      void win.onCloseRequested(async (event) => {
        event.preventDefault();
        if (await cb()) await win.destroy();
      });
    },
    setTitle(title) {
      return getCurrentWindow().setTitle(title);
    },
    fileName(path) {
      return path.split(/[\\/]/).pop() ?? path;
    },
    windowControls: windowControls(),
    material,
  };
}

/** Asks the shell which backdrop it applied (Mica on Windows 11). */
export async function windowMaterial(): Promise<'mica' | 'none'> {
  try {
    return (await invoke<string>('window_material')) === 'mica' ? 'mica' : 'none';
  } catch {
    return 'none';
  }
}

/** Browser-isms that make a desktop app feel wrong: context menus, reload keys, page zoom. */
export function hardenWebview(doc: Document): void {
  doc.addEventListener('contextmenu', (e) => {
    const sel = doc.getSelection()?.toString() ?? '';
    const target = e.target as HTMLElement | null;
    const inInput = !!target?.closest('input, textarea');
    if (!sel && !inInput) e.preventDefault();
  });
  doc.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  doc.addEventListener('dragstart', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('canvas, img')) e.preventDefault();
  });
  doc.addEventListener(
    'keydown',
    (e) => {
      const key = e.key;
      const blocked =
        key === 'F5' ||
        key === 'F3' ||
        key === 'F7' ||
        (e.ctrlKey && (key === 'r' || key === 'R' || key === 'u' || key === 'U' || key === 'j' || key === 'J')) ||
        (e.ctrlKey && e.shiftKey && (key === 'I' || key === 'i'));
      if (blocked) e.preventDefault();
    },
    true,
  );
}
