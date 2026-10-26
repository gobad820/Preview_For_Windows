import { expect, test, type Page } from '@playwright/test';

/** Found by the integration review: unread pages, touch and pen input, the scrollbar strip. */

async function open(page: Page, name = 'simple.pdf') {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
}

async function at(page: Page, fx: number, fy: number) {
  const box = (await page.locator('#viewer .page[data-page="1"]').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

const annots = (page: Page) => page.evaluate(() => (window as any).__pfw.app.document.annotationsAt(0));

/** Saves simple.pdf with one rectangle, so reopening it has annotations to read. */
async function savedWithMarkup(page: Page) {
  await open(page);
  await page.evaluate(async () => {
    const app = (window as any).__pfw.app;
    app.document.setAnnotations(0, [
      { id: 'r0', kind: 'rect', color: '#ff3b30', opacity: 1, modified: '2026-10-26T00:00:00Z', rect: { x0: 400, y0: 100, x1: 500, y1: 160 }, fill: null, width: 2, rounded: false },
    ]);
    await app.save();
  });
}

/** Makes the next reads of annotations wait `ms`, or fail when `ms` is null. */
async function slowRead(page: Page, ms: number | null) {
  await page.evaluate((ms) => {
    const proto = Object.getPrototypeOf((window as any).__pfw.app.document.primary);
    const original = proto.getData;
    proto.getData = function (this: unknown) {
      if (ms === null) return Promise.reject(new Error('simulated read failure'));
      return new Promise((resolve) => setTimeout(() => resolve(original.call(this)), ms));
    };
  }, ms);
}

async function reopen(page: Page) {
  await page.evaluate(() => (window as any).__pfw.app.openPath('fixtures/simple.pdf'));
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
  await page.click('#toolbar [data-action="markup"]');
  await page.waitForTimeout(300);
}

test.describe('pages whose annotations are not read yet', () => {
  test('a text box typed while the file is still being read is kept, and closing asks to save it', async ({ page }) => {
    await savedWithMarkup(page);
    await slowRead(page, 4000);
    await reopen(page);
    expect(await annots(page)).toBeNull();
    await page.click('[data-markup="text"]');
    const c = await at(page, 0.2, 0.35);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type('typed during the read');
    // Closing commits the box; the prompt must appear because there is an unsaved edit.
    const closing = page.evaluate(() => (window as any).__pfwRequestClose());
    await expect(page.locator('.alert')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await closing).toBe(false);
    const list = await annots(page);
    expect(list.map((a: any) => a.kind).sort()).toEqual(['rect', 'text']);
  });

  test('Ctrl+S during the read waits for the edit and saves it', async ({ page }) => {
    await savedWithMarkup(page);
    await slowRead(page, 3000);
    await reopen(page);
    await page.click('[data-markup="text"]');
    const c = await at(page, 0.2, 0.35);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type('saved during the read');
    await page.keyboard.press('Control+s');
    // The save waits for the read, then writes the box: the box exists and nothing is unsaved.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const pfw = (window as any).__pfw;
            return { kinds: pfw.app.document.annotationsAt(0)?.map((a: any) => a.kind).sort(), dirty: pfw.store.get().dirty };
          }),
        { timeout: 10000 },
      )
      .toEqual({ kinds: ['rect', 'text'], dirty: false });
    // Reopen what was written (reads stay slow) and find the box in it.
    await page.evaluate(() => (window as any).__pfw.app.openPath('fixtures/simple.pdf'));
    await expect
      .poll(async () => (await annots(page))?.map((a: any) => a.text ?? a.kind).sort(), { timeout: 10000 })
      .toEqual(['rect', 'saved during the read']);
  });

  test('a shape drawn during the read shows while dragging and ends up selected', async ({ page }) => {
    await savedWithMarkup(page);
    await slowRead(page, 3000);
    await reopen(page);
    await page.click('[data-markup="shapes"]');
    await page.getByRole('menuitemradio', { name: 'Oval', exact: true }).click();
    const a = await at(page, 0.2, 0.3);
    const b = await at(page, 0.4, 0.4);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await expect(page.locator('#viewer .page[data-page="1"] .markup-overlay [data-kind="oval"]')).toHaveCount(1);
    await page.mouse.up();
    await expect.poll(async () => (await annots(page))?.map((x: any) => x.kind).sort(), { timeout: 8000 }).toEqual(['oval', 'rect']);
    const oval = (await annots(page)).find((x: any) => x.kind === 'oval');
    await expect.poll(() => page.evaluate(() => (window as any).__pfw.markup.controller.selected?.annotId)).toBe(oval.id);
  });

  test('when the annotations cannot be read, adding one says so instead of vanishing silently', async ({ page }) => {
    await savedWithMarkup(page);
    await slowRead(page, null);
    await reopen(page);
    await page.click('[data-markup="shapes"]');
    await page.getByRole('menuitemradio', { name: 'Rectangle', exact: true }).click();
    const a = await at(page, 0.2, 0.3);
    const b = await at(page, 0.4, 0.4);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.error-banner')).toBeVisible();
    await expect(page.locator('.error-banner')).toContainText(/markup/i);
  });
});

test.describe('touch and pen', () => {
  test.use({ hasTouch: true });

  test('a touch drag with Draw armed draws instead of scrolling', async ({ page }) => {
    await open(page);
    await page.click('#toolbar [data-action="markup"]');
    await page.click('[data-markup="draw"]');
    const a = await at(page, 0.3, 0.3);
    const b = await at(page, 0.5, 0.45);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await annots(page)).map((x: any) => x.kind)).toEqual(['ink']);
  });
});

test('with a tool armed, a press in the scrollbar strip creates nothing', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).__pfw.viewer.setZoom('custom', 2.5));
  await page.click('#toolbar [data-action="markup"]');
  await page.click('[data-markup="shapes"]');
  await page.getByRole('menuitemradio', { name: 'Rectangle', exact: true }).click();
  const strip = await page.evaluate(() => {
    const c = document.getElementById('viewer')!;
    const r = c.getBoundingClientRect();
    return { x: r.left + c.clientWidth + 3, y: r.top + 200 };
  });
  await page.mouse.move(strip.x, strip.y);
  await page.mouse.down();
  await page.mouse.move(strip.x - 200, strip.y + 100, { steps: 5 });
  await page.mouse.up();
  expect(await annots(page)).toEqual([]);
});
