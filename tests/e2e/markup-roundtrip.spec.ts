import { expect, test, type Page } from '@playwright/test';

/** The whole markup story through the UI: Two Pages, every tool family, save, reopen, edit again. */

async function open(page: Page, name = 'simple.pdf') {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.waitForSelector('#viewer .page[data-page="1"] .textLayer span');
}

const spans = (page: Page, n: number) =>
  page.locator(`#viewer .page[data-page="${n}"] .textLayer > span, #viewer .page[data-page="${n}"] .textLayer .markedContent > span`);

async function at(page: Page, n: number, fx: number, fy: number) {
  const box = (await page.locator(`#viewer .page[data-page="${n}"]`).boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function pickShape(page: Page, label: string) {
  await page.click('[data-markup="shapes"]');
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

const kinds = (page: Page, index: number) =>
  page.evaluate((i) => ((window as any).__pfw.app.document.annotationsAt(i) ?? []).map((a: any) => a.kind).sort(), index);

test('mark up a spread in Two Pages, save, reopen and keep editing', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page);
  // The markup bar takes height from the view, which re-fits the pages: open it first.
  await page.click('#toolbar [data-action="markup"]');
  await page.evaluate(() => (window as any).__pfw.store.set({ displayMode: 'two-pages' }));
  await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-page'));
  await expect
    .poll(async () => {
      const a = await page.locator('#viewer .page[data-page="1"]').boundingBox();
      const b = await page.locator('#viewer .page[data-page="2"]').boundingBox();
      return !!a && !!b && Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < 1 && b.x > a.x + a.width;
    })
    .toBe(true);
  await page.waitForSelector('#viewer .page[data-page="2"] .textLayer span');
  // Text layers are rebuilt after the zoom change; wait until both lines stop moving.
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify([await spans(page, 1).nth(3).boundingBox(), await spans(page, 2).nth(0).boundingBox()]);
      const stable = now === last && !now.includes('null');
      last = now;
      return stable;
    })
    .toBe(true);

  // Highlight from the last line of page 1 into the title of page 2: one mark per page.
  await page.click('#toolbar [data-action="highlight"]');
  const from = (await spans(page, 1).nth(3).boundingBox())!;
  const to = (await spans(page, 2).nth(0).boundingBox())!;
  await page.mouse.move(from.x + 1, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 1, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => kinds(page, 1)).toEqual(['highlight']);
  const marked = await page.evaluate(() => [0, 1].map((i) => (window as any).__pfw.app.document.annotationsAt(i)[0].text));
  expect(marked).toEqual(['Preview for Windows renders this with pdf.js.', 'Hello world page 2']);
  await page.click('#toolbar [data-action="highlight"]');

  // A rectangle on page 1 and an arrow on page 2.
  await pickShape(page, 'Rectangle');
  await drag(page, await at(page, 1, 0.2, 0.45), await at(page, 1, 0.5, 0.6));
  await pickShape(page, 'Arrow');
  await drag(page, await at(page, 2, 0.7, 0.6), await at(page, 2, 0.4, 0.45));

  // A Korean text box on page 1 and a note on page 2.
  await page.click('[data-markup="text"]');
  const t = await at(page, 1, 0.2, 0.7);
  await page.mouse.click(t.x, t.y);
  await page.keyboard.type('검토 필요: Hello');
  await page.keyboard.press('Escape');
  await page.click('[data-markup="note"]');
  const n = await at(page, 2, 0.8, 0.2);
  await page.mouse.click(n.x, n.y);
  await page.keyboard.type('메모 내용');
  await page.keyboard.press('Escape');

  expect(await kinds(page, 0)).toEqual(['highlight', 'rect', 'text']);
  expect(await kinds(page, 1)).toEqual(['arrow', 'highlight', 'note']);
  await expect(page.locator('[data-doc-edited]')).toBeVisible();

  // Save over the file, then reopen it in this window.
  await page.keyboard.press('Control+s');
  await expect(page.locator('[data-doc-edited]')).toBeHidden();
  await page.evaluate(() => (window as any).__pfw.app.openPath('fixtures/simple.pdf'));
  await page.waitForFunction(() => {
    const d = (window as any).__pfw.app.document;
    return d && d.hideGeneration(0) === 1 && d.annotationsAt(1)?.length === 3;
  });
  expect(await kinds(page, 0)).toEqual(['highlight', 'rect', 'text']);
  expect(await kinds(page, 1)).toEqual(['arrow', 'highlight', 'note']);
  const texts = await page.evaluate(() =>
    [0, 1].flatMap((i) => (window as any).__pfw.app.document.annotationsAt(i).filter((a: any) => a.kind === 'text' || a.kind === 'note').map((a: any) => a.text)),
  );
  expect(texts).toEqual(['검토 필요: Hello', '메모 내용']);
  // The overlay draws what the canvas no longer does.
  await expect(page.locator('#viewer .page[data-page="1"] .markup-overlay .mk-text')).toHaveText('검토 필요: Hello');

  // Reopened annotations are editable: select the rectangle by its edge and delete it.
  await page.waitForTimeout(300);
  const rect = await page.evaluate(() => (window as any).__pfw.app.document.annotationsAt(0).find((a: any) => a.kind === 'rect').rect);
  const edge = await page.evaluate((r) => {
    const view = (window as any).__pfw.viewer.getPageViews().find((v: any) => v.index === 0);
    const box = view.el.getBoundingClientRect();
    const [x, y] = view.viewport.convertToViewportPoint(r.x0, (r.y0 + r.y1) / 2);
    return { x: box.left + x, y: box.top + y };
  }, rect);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(() => page.evaluate(() => (window as any).__pfw.markup.controller.selected?.annotId)).toBe(
    await page.evaluate(() => (window as any).__pfw.app.document.annotationsAt(0).find((a: any) => a.kind === 'rect').id),
  );
  await page.keyboard.press('Delete');
  expect(await kinds(page, 0)).toEqual(['highlight', 'text']);
  await expect(page.locator('[data-doc-edited]')).toBeVisible();
  await page.keyboard.press('Control+z');
  expect(await kinds(page, 0)).toEqual(['highlight', 'rect', 'text']);
  await expect(page.locator('[data-doc-edited]')).toBeHidden();
});
