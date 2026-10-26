import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
  await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
  await page.waitForSelector('#sidebar .thumb[data-page="1"]');
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
/** `src:index` of every page in order. */
const keys = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const doc = (window as any).__pfw.app.document;
    return Array.from({ length: doc.numPages }, (_, i) => doc.pageKey(i));
  });
const selected = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#sidebar .thumb.selected')].map((t) => t.dataset['page']!));
const thumb = (page: Page, n: number) => page.locator(`#sidebar .thumb[data-page="${n}"]`);
/** Page elements in the viewer, failing on duplicates (stale elements left behind by an edit). */
async function expectCleanPages(page: Page) {
  const pages = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#viewer .page')].map((p) => p.dataset['page']!));
  expect(new Set(pages).size).toBe(pages.length);
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('#viewer .page.loading').length), { timeout: 5000 })
    .toBe(0);
}

async function center(page: Page, n: number) {
  const box = (await thumb(page, n).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y, bottom: box.y + box.height };
}

/** Drags thumbnail `from` to just above (`'before'`) or below (`'after'`) thumbnail `to`. */
async function dragThumb(page: Page, from: number, to: number, where: 'before' | 'after', release = true) {
  await thumb(page, from).scrollIntoViewIfNeeded();
  const a = await center(page, from);
  const b = await center(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const y = where === 'before' ? b.top + 4 : b.bottom - 4;
  await page.mouse.move(a.x, a.y + (y > a.y ? 8 : -8), { steps: 2 });
  await page.mouse.move(b.x, y, { steps: 8 });
  if (release) await page.mouse.up();
}

/** Dispatches an HTML5 file drop of fixture `name` at the gap above thumbnail `n` (or below the last). */
async function dropFixture(page: Page, name: string, n: number, where: 'before' | 'after' = 'before') {
  const target = await center(page, n);
  const y = where === 'before' ? target.top + 3 : target.bottom - 3;
  await page.evaluate(
    async ({ name, x, y }) => {
      const res = await fetch(`fixtures/${encodeURIComponent(name)}`);
      const file = new File([await res.arrayBuffer()], name, { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.elementFromPoint(x, y) ?? document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      }
    },
    { name, x: target.x, y },
  );
}

// Tall enough that a three-page document's thumbnails all fit in the sidebar.
test.use({ viewport: { width: 1200, height: 1000 } });

test.describe('page editing', () => {
  test('clicks, Ctrl and Shift select thumbnails', async ({ page }) => {
    await open(page, 'outline.pdf');
    await thumb(page, 2).click();
    expect(await selected(page)).toEqual(['2']);
    await thumb(page, 4).click({ modifiers: ['Control'] });
    expect(await selected(page)).toEqual(['2', '4']);
    await thumb(page, 6).click({ modifiers: ['Shift'] });
    expect(await selected(page)).toEqual(['4', '5', '6']);
    await thumb(page, 1).click();
    expect(await selected(page)).toEqual(['1']);
    expect((await state(page)).currentPage).toBe(1);
  });

  test('arrow keys and Ctrl+A in the focused list', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 1).click();
    await page.keyboard.press('ArrowDown');
    expect(await selected(page)).toEqual(['2']);
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
    await page.keyboard.press('Shift+ArrowDown');
    expect(await selected(page)).toEqual(['2', '3']);
    await page.keyboard.press('Control+a');
    expect(await selected(page)).toEqual(['1', '2', '3']);
  });

  test('dragging a thumbnail to the top reorders pages', async ({ page }) => {
    await open(page, 'simple.pdf');
    await dragThumb(page, 3, 1, 'before', false);
    await expect(page.locator('.drag-ghost')).toHaveCount(1);
    await expect(page.locator('#sidebar .drop-indicator')).toBeVisible();
    await page.mouse.up();
    expect(await keys(page)).toEqual(['0:2', '0:0', '0:1']);
    await expectCleanPages(page);
    await expect(page.locator('.drag-ghost')).toHaveCount(0);
    expect((await state(page)).dirty).toBe(true);
    await expect(page).toHaveTitle('simple.pdf — Edited');
    expect(await selected(page)).toEqual(['1']);
  });

  test('dragging a non-contiguous selection to the end', async ({ page }) => {
    await open(page, 'outline.pdf');
    await thumb(page, 2).click();
    await thumb(page, 5).click({ modifiers: ['Control'] });
    await dragThumb(page, 5, 6, 'after');
    expect(await keys(page)).toEqual(['0:0', '0:2', '0:3', '0:5', '0:1', '0:4']);
    await expectCleanPages(page);
    expect(await selected(page)).toEqual(['5', '6']);
  });

  test('dropping a selection into its own gap changes nothing', async ({ page }) => {
    await open(page, 'outline.pdf');
    await thumb(page, 2).click();
    await thumb(page, 3).click({ modifiers: ['Shift'] });
    await dragThumb(page, 2, 3, 'before');
    expect(await keys(page)).toEqual(['0:0', '0:1', '0:2', '0:3', '0:4', '0:5']);
    expect((await state(page)).dirty).toBe(false);
  });

  test('Escape cancels a drag', async ({ page }) => {
    await open(page, 'simple.pdf');
    await dragThumb(page, 3, 1, 'before', false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await keys(page)).toEqual(['0:0', '0:1', '0:2']);
    await expect(page.locator('.drag-ghost')).toHaveCount(0);
  });

  test('Delete removes pages; undo and redo track the saved state', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 2).click();
    await page.keyboard.press('Delete');
    expect(await keys(page)).toEqual(['0:0', '0:2']);
    expect(await selected(page)).toEqual(['2']);
    expect((await state(page)).numPages).toBe(2);
    await page.keyboard.press('Control+z');
    expect(await keys(page)).toEqual(['0:0', '0:1', '0:2']);
    expect((await state(page)).dirty).toBe(false);
    await page.keyboard.press('Control+y');
    expect(await keys(page)).toEqual(['0:0', '0:2']);
    expect((await state(page)).dirty).toBe(true);
    await page.keyboard.press('Control+Shift+z');
    expect(await keys(page)).toEqual(['0:0', '0:2']);
  });

  test('the last page cannot be deleted', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 1).click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    expect((await state(page)).numPages).toBe(3);
    await expect(page.locator('.error-banner')).toContainText('at least one page');
  });

  test('copy and paste duplicate pages after the selection', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 1).click();
    await page.keyboard.press('Control+c');
    await thumb(page, 3).click();
    await page.keyboard.press('Control+v');
    await expect.poll(() => keys(page)).toEqual(['0:0', '0:1', '0:2', '0:0']);
    expect(await selected(page)).toEqual(['4']);
    // The copy also went to the system clipboard as a PDF for other windows.
    expect(await page.evaluate(() => [...(window as any).__pfwFiles.keys()].some((k: string) => k.startsWith('clipboard-')))).toBe(true);
  });

  test('cut and paste moves pages', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 1).click();
    await page.keyboard.press('Control+x');
    await expect.poll(() => keys(page)).toEqual(['0:1', '0:2']);
    await thumb(page, 2).click();
    await page.keyboard.press('Control+v');
    await expect.poll(() => keys(page)).toEqual(['0:1', '0:2', '0:0']);
    await expectCleanPages(page);
  });

  test('pastes pages copied in another window', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => ((window as any).__pfwExternalClipboard = ['fixtures/한글 문서.pdf']));
    await thumb(page, 1).click();
    await page.keyboard.press('Control+v');
    await expect.poll(() => keys(page)).toEqual(['0:0', '1:0', '1:1', '0:1', '0:2']);
    const text = await page.evaluate(async () =>
      ((await (window as any).__pfw.app.document.getPageText(1)) as Array<{ str: string }>).map((t) => t.str).join(''),
    );
    expect(text).toContain('미리보기');
  });

  test('dropping a PDF between thumbnails merges it there', async ({ page }) => {
    await open(page, 'simple.pdf');
    await dropFixture(page, 'mixed.pdf', 2, 'before');
    await expect.poll(() => keys(page)).toEqual(['0:0', '1:0', '1:1', '1:2', '0:1', '0:2']);
    await expectCleanPages(page);
    expect(await selected(page)).toEqual(['2', '3', '4']);
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
    expect((await state(page)).dirty).toBe(true);
  });

  test('merging a password-protected PDF asks for its password', async ({ page }) => {
    await open(page, 'simple.pdf');
    await dropFixture(page, 'encrypted.pdf', 3, 'after');
    const panel = page.getByRole('alertdialog');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('encrypted.pdf');
    await panel.locator('input.alert-input').fill('wrong');
    await page.keyboard.press('Enter');
    await expect(panel).toContainText(/incorrect/i);
    await panel.locator('input.alert-input').fill('secret');
    await page.keyboard.press('Enter');
    await expect.poll(() => keys(page)).toEqual(['0:0', '0:1', '0:2', '1:0']);
    await expect(panel).toBeHidden();
  });

  test('Ctrl+S writes the edited document over the file', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 2).click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await state(page)).dirty).toBe(false);
    await expect(page).toHaveTitle('simple.pdf');
    const pages = await page.evaluate(async () => {
      const bytes: Uint8Array = (window as any).__pfwFiles.get('fixtures/simple.pdf');
      return bytes ? bytes.length > 0 : false;
    });
    expect(pages).toBe(true);
    // Re-open from the saved bytes.
    await page.evaluate(() => (window as any).__pfw.app.openPath('fixtures/simple.pdf'));
    await expect.poll(async () => (await state(page)).numPages).toBe(2);
    const text = await page.evaluate(async () =>
      ((await (window as any).__pfw.app.document.getPageText(1)) as Array<{ str: string }>).map((t) => t.str).join(''),
    );
    expect(text).toContain('Hello world page 3');
  });

  test('Save As writes a copy and keeps editing the copy', async ({ page }) => {
    await open(page, 'simple.pdf');
    await dropFixture(page, '한글 문서.pdf', 1, 'before');
    await expect.poll(async () => (await state(page)).numPages).toBe(5);
    await page.evaluate(() => ((window as any).__pfwNextSavePath = 'out/merged'));
    await page.keyboard.press('Control+Shift+s');
    await expect.poll(async () => (await state(page)).fileName).toBe('merged.pdf');
    expect((await state(page)).filePath).toBe('out/merged.pdf');
    expect((await state(page)).dirty).toBe(false);
    expect(await page.evaluate(() => (window as any).__pfwFiles.has('out/merged.pdf'))).toBe(true);
    expect(await page.evaluate(() => (window as any).__pfwFiles.has('fixtures/simple.pdf'))).toBe(false);
  });

  test('the outline follows moved pages', async ({ page }) => {
    await open(page, 'outline.pdf');
    await page.evaluate(() => {
      const w = window as any;
      w.__pfw.editor.selection.set([w.__pfw.app.document.pages[5].id]);
      w.__pfw.editor.moveSelectionTo(0);
    });
    await page.locator('#sidebar [data-tab="outline"]').click();
    await expect(page.getByRole('button', { name: 'Appendix', exact: true })).toHaveAttribute('data-page', '1');
    await expect(page.getByRole('button', { name: 'Chapter 1', exact: true })).toHaveAttribute('data-page', '2');
  });

  test('search results follow moved pages', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.findBar.open());
    await page.locator('input[data-find-input]').fill('world page 3');
    await expect(page.locator('[data-find-count]')).toHaveText('1 of 1');
    await dragThumb(page, 3, 1, 'before');
    await expect(page.locator('[data-find-count]')).toHaveText('1 of 1');
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(0));
    await expect(page.locator('.page[data-page="1"] mark.find-match')).toHaveCount(1);
  });

  test('the thumbnail context menu edits pages', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 2).click({ button: 'right' });
    expect(await selected(page)).toEqual(['2']);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Copy/ })).toBeVisible();
    await menu.getByRole('menuitem', { name: /Delete/ }).click();
    await expect(menu).toBeHidden();
    expect(await keys(page)).toEqual(['0:0', '0:2']);
  });

  test('Insert Pages from File merges after the selection', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 1).click();
    await page.evaluate(() => ((window as any).__pfwNextOpenPaths = ['fixtures/mixed.pdf', 'fixtures/한글 문서.pdf']));
    await thumb(page, 1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Insert Pages from File/ }).click();
    await expect
      .poll(() => keys(page))
      .toEqual(['0:0', '1:0', '1:1', '1:2', '2:0', '2:1', '0:1', '0:2']);
  });

  test('closing with unsaved changes asks first', async ({ page }) => {
    await open(page, 'simple.pdf');
    expect(await page.evaluate(() => (window as any).__pfwRequestClose())).toBe(true); // clean: closes
    await thumb(page, 2).click();
    await page.keyboard.press('Delete');
    const ask = page.evaluate(() => (window as any).__pfwRequestClose());
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('Do you want to save the changes made to the document “simple.pdf”?');
    await alert.getByRole('button', { name: 'Cancel' }).click();
    expect(await ask).toBe(false);
    expect((await state(page)).dirty).toBe(true);

    const discard = page.evaluate(() => (window as any).__pfwRequestClose());
    await alert.getByRole('button', { name: "Don't Save" }).click();
    expect(await discard).toBe(true);
    expect(await page.evaluate(() => (window as any).__pfwFiles.has('fixtures/simple.pdf'))).toBe(false);

    const save = page.evaluate(() => (window as any).__pfwRequestClose());
    await alert.getByRole('button', { name: 'Save', exact: true }).click();
    expect(await save).toBe(true);
    expect(await page.evaluate(() => (window as any).__pfwFiles.has('fixtures/simple.pdf'))).toBe(true);
    expect((await state(page)).dirty).toBe(false);
  });

  test('opening another file into an edited window asks first', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 2).click();
    await page.keyboard.press('Delete');
    const opening = page.evaluate(() => (window as any).__pfw.app.openOrSpawn('fixtures/mixed.pdf'));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await opening;
    expect((await state(page)).fileName).toBe('simple.pdf');
    expect((await state(page)).numPages).toBe(2);
  });

  test('edits above the view keep the visible page and reuse its rendering', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: false }));
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(149));
    await page.waitForSelector('.page[data-page="150"] canvas[data-rendered="true"]');
    const deleted = await page.evaluate(() => {
      const w = window as any;
      const doc = w.__pfw.app.document;
      const ids = [140, 141, 142, 143, 144].map((i) => doc.pages[i].id);
      w.__pfw.editor.selection.set(ids);
      w.__pfw.editor.deleteSelection();
      return doc.numPages;
    });
    expect(deleted).toBe(295);
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(149));
    await page.waitForSelector('.page[data-page="150"] canvas[data-rendered="true"]');
    await page.evaluate(() => {
      (window as any).__marked = document.querySelector('.page[data-page="150"] canvas');
    });
    await page.evaluate(() => (window as any).__pfw.editor.undo());
    await expect.poll(async () => (await state(page)).numPages).toBe(300);
    // The same page (now 155) keeps its element and bitmap; nothing above it re-rendered it.
    expect(await page.evaluate(() => document.querySelector('.page[data-page="155"] canvas') === (window as any).__marked)).toBe(true);
    expect((await state(page)).currentPage).toBe(155);
    expect(await page.locator('.page').count()).toBeLessThanOrEqual(10);
    await expectCleanPages(page);
  });
});

test.describe('saving safety and review fixes', () => {
  const file = (page: Page, path: string) =>
    page.evaluate((p) => {
      const b: Uint8Array | undefined = (window as any).__pfwFiles.get(p);
      return b ? b.length : 0;
    }, path);
  const pagesIn = (page: Page, path: string) =>
    page.evaluate(async (p) => {
      const app = (window as any).__pfw.app;
      const bytes: Uint8Array = (window as any).__pfwFiles.get(p);
      // Open the saved bytes with a throwaway EditableDocument (the class of the open one).
      const doc = await app.document.constructor.open(bytes.slice());
      const n = doc.numPages;
      await doc.destroy();
      return n;
    }, path);

  test('edits made while a save is running stay unsaved', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 2).click();
    await page.keyboard.press('Delete');
    await page.evaluate(() => ((window as any).__pfwWriteDelayMs = 400));
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(50);
    await page.keyboard.press('Delete'); // another page while the write is still running
    await expect.poll(() => file(page, 'fixtures/simple.pdf'), { timeout: 5000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await state(page)).numPages).toBe(1);
    expect((await state(page)).dirty).toBe(true);
    await expect(page).toHaveTitle('simple.pdf — Edited');
    expect(await pagesIn(page, 'fixtures/simple.pdf')).toBe(2);
    // A second save is queued, not dropped.
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await state(page)).dirty, { timeout: 5000 }).toBe(false);
    expect(await pagesIn(page, 'fixtures/simple.pdf')).toBe(1);
  });

  test('Ctrl+S does nothing when there is nothing to save', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(300);
    expect(await file(page, 'fixtures/simple.pdf')).toBe(0);
  });

  test('undo after saving brings back "Edited", redo clears it', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 2).click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+s');
    await expect(page).toHaveTitle('simple.pdf');
    await page.keyboard.press('Control+z');
    await expect(page).toHaveTitle('simple.pdf — Edited');
    await page.keyboard.press('Control+y');
    await expect(page).toHaveTitle('simple.pdf');
  });

  test('a file changed by another app is not overwritten without asking', async ({ page }) => {
    await open(page, 'simple.pdf');
    await thumb(page, 2).click();
    await page.keyboard.press('Delete');
    await page.evaluate(() => (window as any).__pfwFiles.set('fixtures/simple.pdf', new Uint8Array([37, 80, 68, 70])));
    await page.keyboard.press('Control+s');
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('has been changed by another application');
    await alert.getByRole('button', { name: 'Cancel' }).click();
    expect(await file(page, 'fixtures/simple.pdf')).toBe(4);
    expect((await state(page)).dirty).toBe(true);
    await page.keyboard.press('Control+s');
    await alert.getByRole('button', { name: 'Replace' }).click();
    await expect.poll(() => file(page, 'fixtures/simple.pdf')).toBeGreaterThan(4);
    expect((await state(page)).dirty).toBe(false);
  });

  test('dragging the page you are viewing keeps it selected and in view', async ({ page }) => {
    await open(page, 'outline.pdf');
    await thumb(page, 4).click();
    await expect.poll(async () => (await state(page)).currentPage).toBe(4);
    await page.evaluate(() => (window as any).__pfw.editor.moveSelectionTo(0));
    expect(await keys(page)).toEqual(['0:3', '0:0', '0:1', '0:2', '0:4', '0:5']);
    expect(await selected(page)).toEqual(['1']);
    await expect.poll(async () => (await state(page)).currentPage).toBe(1);
    await expect(page.locator('#sidebar .thumb.current')).toHaveCount(1);
  });

  test('cut removes the pages it copied even if the selection changes', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => ((window as any).__pfwClipboardDelayMs = 300));
    await thumb(page, 1).click();
    await page.keyboard.press('Control+x');
    await thumb(page, 2).click();
    await expect.poll(() => keys(page)).toEqual(['0:1', '0:2']);
  });

  test('Delete in the Contents tab does not delete pages', async ({ page }) => {
    await open(page, 'outline.pdf');
    await page.locator('#sidebar [data-tab="outline"]').click();
    await page.getByRole('button', { name: 'Chapter 1', exact: true }).focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    expect((await state(page)).numPages).toBe(6);
  });

  test('paste uses the in-window copy while the system clipboard is busy or failed', async ({ page }) => {
    await open(page, 'simple.pdf');
    // The system clipboard still holds an older PDF from elsewhere.
    await page.evaluate(() => {
      const w = window as any;
      w.__pfwExternalClipboard = ['fixtures/mixed.pdf'];
      w.__pfwClipboardDelayMs = 300;
    });
    await thumb(page, 3).click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v'); // before the system write has finished
    await expect.poll(() => keys(page)).toEqual(['0:0', '0:1', '0:2', '0:2']);
    await page.evaluate(() => {
      const w = window as any;
      w.__pfwExternalClipboard = ['fixtures/mixed.pdf'];
      w.__pfwClipboardDelayMs = 0;
      w.__pfwClipboardFail = true;
    });
    await thumb(page, 1).click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect.poll(() => keys(page)).toEqual(['0:0', '0:0', '0:1', '0:2', '0:2']);
  });

  test('a merged password-protected file saves without its password', async ({ page }) => {
    await open(page, 'simple.pdf');
    await dropFixture(page, 'encrypted.pdf', 3, 'after');
    const alert = page.getByRole('alertdialog');
    await alert.locator('input.alert-input').fill('secret');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).numPages).toBe(4);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await state(page)).dirty).toBe(false);
    expect(await pagesIn(page, 'fixtures/simple.pdf')).toBe(4);
  });

  test('a file restricted by an owner password can be edited and saved', async ({ page }) => {
    await open(page, 'restricted-aes.pdf');
    await thumb(page, 1).click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await state(page)).dirty).toBe(false);
    expect(await pagesIn(page, 'fixtures/restricted-aes.pdf')).toBe(2);
    await expect(page.locator('.error-banner')).toBeHidden();
  });

  test('releasing a drag outside the list moves nothing', async ({ page }) => {
    await open(page, 'simple.pdf');
    await dragThumb(page, 3, 1, 'before', false);
    await page.mouse.move(700, 400, { steps: 4 });
    await page.mouse.up();
    expect(await keys(page)).toEqual(['0:0', '0:1', '0:2']);
    expect((await state(page)).dirty).toBe(false);
  });
});
