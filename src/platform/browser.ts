import type { Platform } from './types';

/**
 * Browser shim used by the Playwright suite and `npm run dev` outside Tauri.
 * Paths are URLs relative to the page (e.g. `fixtures/simple.pdf`) or `blob:<name>` keys for
 * files chosen through the file input or dropped with HTML5 drag-and-drop.
 */
export function browserPlatform(): Platform {
  const blobs = new Map<string, File>();
  const dropHandlers = new Set<(path: string) => void>();
  const dragHandlers = new Set<(over: boolean) => void>();
  let dragDepth = 0;

  const register = (file: File): string => {
    const key = `blob:${file.name}`;
    blobs.set(key, file);
    return key;
  };
  const setDrag = (over: boolean) => dragHandlers.forEach((h) => h(over));

  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    if (dragDepth++ === 0) setDrag(true);
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    if (--dragDepth <= 0) {
      dragDepth = 0;
      setDrag(false);
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    setDrag(false);
    const file = Array.from(e.dataTransfer?.files ?? []).find((f) => /\.pdf$/i.test(f.name));
    if (file) {
      const key = register(file);
      dropHandlers.forEach((h) => h(key));
    }
  });

  return {
    async readFile(path) {
      const file = blobs.get(path);
      if (file) return new Uint8Array(await file.arrayBuffer());
      const res = await fetch(encodeURI(path));
      if (!res.ok) throw new Error(`HTTP ${res.status} while reading ${path}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    openFileDialog() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,application/pdf';
        input.hidden = true;
        input.dataset['fileInput'] = '';
        document.body.append(input);
        const finish = (value: string | null) => {
          input.remove();
          resolve(value);
        };
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          finish(file ? register(file) : null);
        });
        input.addEventListener('cancel', () => finish(null));
        input.click();
      });
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
  };
}
