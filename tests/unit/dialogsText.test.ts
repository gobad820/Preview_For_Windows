import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { readOwnAnnotations } from '../../src/annot/reader';
import { writePdf } from '../../src/edit/writer';
import { setLocale } from '../../src/i18n';
import { PdfDocument, type PdfAssets } from '../../src/pdf/document';

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const nm = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
const assets: PdfAssets = { cMapUrl: `${nm}cmaps/`, standardFontDataUrl: `${nm}standard_fonts/`, wasmUrl: `${nm}wasm/` };
const open = async (name: string, password?: string) => PdfDocument.load(await fixture(name), { password, assets });
const noOutline = { outline: [] };

/** The error messages users see are in the UI language; their kinds stay the same. */
describe('error messages follow the UI language', () => {
  afterEach(() => setLocale('en'));

  test('opening a file that is not a PDF', async () => {
    await expect(open('broken.pdf')).rejects.toMatchObject({ kind: 'invalid', message: 'This file is not a valid PDF.' });
    setLocale('ko');
    await expect(open('broken.pdf')).rejects.toMatchObject({ kind: 'invalid', message: '유효한 PDF 파일이 아닙니다.' });
  });

  test('opening a protected file without or with a wrong password', async () => {
    setLocale('ko');
    await expect(open('encrypted.pdf')).rejects.toMatchObject({ kind: 'password', message: '이 문서는 암호로 보호되어 있습니다.' });
    await expect(open('encrypted.pdf', 'wrong')).rejects.toMatchObject({ kind: 'password', message: '암호가 올바르지 않습니다.' });
  });

  test('reading annotations of a protected file', async () => {
    setLocale('ko');
    await expect(readOwnAnnotations(await fixture('encrypted.pdf'))).rejects.toMatchObject({
      kind: 'password',
      message: '이 문서는 암호로 보호되어 있습니다.',
    });
  });

  test('writing a protected source without its password, or no pages', async () => {
    setLocale('ko');
    const src = { id: 0, bytes: await fixture('encrypted.pdf') };
    await expect(writePdf([src], [{ src: 0, index: 0 }], noOutline)).rejects.toMatchObject({
      kind: 'password',
      message: '이 문서는 암호로 보호되어 있습니다.',
    });
    await expect(writePdf([src], [], noOutline)).rejects.toThrow('PDF에는 페이지가 하나 이상 있어야 합니다.');
  });
});
