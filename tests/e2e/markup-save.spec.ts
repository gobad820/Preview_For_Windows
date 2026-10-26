import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
}

/** RGB of the rendered canvas of page 1 at a point given as fractions of the page. */
const pixel = (page: Page, fx: number, fy: number) =>
  page.evaluate(
    ([fx, fy]) => {
      const c = document.querySelector<HTMLCanvasElement>('#viewer .page[data-page="1"] canvas[data-rendered="true"]')!;
      const d = c.getContext('2d')!.getImageData(Math.round(c.width * fx!), Math.round(c.height * fy!), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    [fx, fy],
  );

test('a saved annotation is read back on reopen and no longer drawn by the page canvas', async ({ page }) => {
  await open(page, 'simple.pdf');
  // A large red highlight across the middle of page 1 (A4: 595 x 842 pt).
  await page.evaluate(async () => {
    const app = (window as any).__pfw.app;
    app.document.setAnnotations(0, [
      {
        id: 'hl-1',
        kind: 'highlight',
        color: '#ff0000',
        opacity: 1,
        modified: '2026-10-26T00:00:00.000Z',
        quads: [[100, 500, 500, 500, 100, 340, 500, 340]],
        text: '',
      },
    ]);
    await app.save();
  });
  const saved = await page.evaluate(() => {
    const bytes: Uint8Array = (window as any).__pfwFiles.get('fixtures/simple.pdf');
    return new TextDecoder('latin1').decode(bytes).includes('/PFWAnnot');
  });
  expect(saved).toBe(true);

  // Reopen the saved file in the same window: pdf.js first, then our reading takes over.
  await page.evaluate(() => (window as any).__pfw.app.openPath('fixtures/simple.pdf'));
  await page.waitForFunction(() => {
    const doc = (window as any).__pfw.app.document;
    return doc && doc.hideGeneration(0) === 1 && doc.annotationsAt(0)?.length === 1;
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('#viewer .page[data-page="1"]');
    return !!el?.querySelector('canvas[data-rendered="true"]');
  });
  // The canvas was re-rendered without it (an overlay draws it from the model instead).
  await expect.poll(() => pixel(page, 300 / 595, (842 - 420) / 842)).toEqual([255, 255, 255]);
  expect(await page.evaluate(() => (window as any).__pfw.store.get().dirty)).toBe(false);
});
