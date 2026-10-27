import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { setLocale } from '../../src/i18n';
import type { PdfAssets } from '../../src/pdf/document';
import { sample } from './annotSamples';

// The Tauri shell is not there under Node: stand-ins record what the native dialogs are asked for.
const dialog = vi.hoisted(() => ({ open: vi.fn(async () => null), save: vi.fn(async () => null) }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
// Annotations this app wrote that cannot be parsed.
vi.mock('../../src/annot/reader', async (original) => ({
  ...(await original<typeof import('../../src/annot/reader')>()),
  readOwnAnnotations: async () => {
    throw new Error('unparsable');
  },
}));

const { tauriPlatform } = await import('../../src/platform/tauri');
const { EditableDocument } = await import('../../src/edit/document');

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const nm = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
const assets: PdfAssets = { cMapUrl: `${nm}cmaps/`, standardFontDataUrl: `${nm}standard_fonts/`, wasmUrl: `${nm}wasm/` };

describe('UI language outside the window', () => {
  afterEach(() => {
    setLocale('en');
    dialog.open.mockClear();
    dialog.save.mockClear();
  });

  test('native open and save dialogs are titled in the UI language, with a translated PDF filter', async () => {
    const platform = tauriPlatform();
    const asked = async () => {
      await platform.openFileDialog();
      await platform.openFilesDialog();
      await platform.saveFileDialog('a.pdf');
      const [[open], [insert]] = dialog.open.mock.calls as unknown as [[object], [object]];
      const [[save]] = dialog.save.mock.calls as unknown as [[object]];
      dialog.open.mockClear();
      dialog.save.mockClear();
      return { open, insert, save };
    };
    const pdf = (name: string) => [{ name, extensions: ['pdf'] }];

    expect(await asked()).toEqual({
      open: { title: 'Open', multiple: false, directory: false, filters: pdf('PDF Document') },
      insert: { title: 'Insert Pages from File', multiple: true, directory: false, filters: pdf('PDF Document') },
      save: { title: 'Save As', defaultPath: 'a.pdf', filters: pdf('PDF Document') },
    });
    setLocale('ko');
    expect(await asked()).toEqual({
      open: { title: '열기', multiple: false, directory: false, filters: pdf('PDF 문서') },
      insert: { title: '파일에서 페이지 삽입', multiple: true, directory: false, filters: pdf('PDF 문서') },
      save: { title: '다른 이름으로 저장', defaultPath: 'a.pdf', filters: pdf('PDF 문서') },
    });
  });

  test("a page whose annotations can't be read says so in the UI language", async () => {
    const original = await EditableDocument.open(await fixture('simple.pdf'), { assets });
    original.updateAnnotations(new Map([[0, sample()]]));
    const saved = await original.save();
    await original.destroy();

    setLocale('ko');
    const doc = await EditableDocument.open(saved, { assets });
    await expect(doc.loadAnnotations(0)).rejects.toThrow('이 페이지의 주석을 읽을 수 없습니다.');
    await doc.destroy();
  });
});
