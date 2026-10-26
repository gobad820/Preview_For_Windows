import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import type { Platform } from './types';

export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

const isPdf = (p: string) => /\.pdf$/i.test(p);

/** Platform backed by the Tauri shell: native file reads, dialogs and OS drag-and-drop. */
export function tauriPlatform(): Platform {
  const dropHandlers = new Set<(path: string) => void>();
  const dragHandlers = new Set<(over: boolean) => void>();
  let over = false;
  const setOver = (v: boolean) => {
    if (over === v) return;
    over = v;
    dragHandlers.forEach((h) => h(v));
  };

  void getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === 'enter') setOver(p.paths.some(isPdf));
    else if (p.type === 'leave') setOver(false);
    else if (p.type === 'drop') {
      setOver(false);
      const path = p.paths.find(isPdf);
      if (path) dropHandlers.forEach((h) => h(path));
    }
  });

  return {
    async readFile(path) {
      const buf = await invoke<ArrayBuffer>('read_file', { path });
      return new Uint8Array(buf);
    },
    async openFileDialog() {
      const result = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (typeof result === 'string') return result;
      if (Array.isArray(result)) return (result[0] as string | undefined) ?? null;
      return null;
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
    setTitle(title) {
      return getCurrentWindow().setTitle(title);
    },
    fileName(path) {
      return path.split(/[\\/]/).pop() ?? path;
    },
  };
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
