import { expect, test, type Page } from '@playwright/test';

const PADDING = 24;

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());

const twoPages = (page: Page, bookMode = false) =>
  page.evaluate((book) => (window as any).__pfw.store.set({ displayMode: 'two-pages', bookMode: book }), bookMode);

/** Waits until the viewer lays out pages 1 and 2 in one row. */
const waitForPairs = (page: Page) =>
  expect.poll(() => page.evaluate(() => (window as any).__pfw.viewer.getLayout().rows[0]?.last)).toBe(1);

/** Client rect of page `n` (1-based) and of the page layer. */
const rects = (page: Page, ...pages: number[]) =>
  page.evaluate((ns) => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      layer: box(document.querySelector('#viewer .page-layer'))!,
      pages: ns.map((n) => box(document.querySelector(`#viewer .page[data-page="${n}"]`))),
    };
  }, pages);

const centerY = (r: { top: number; height: number }) => r.top + r.height / 2;

test.describe('two pages', () => {
  test('puts pages 1 and 2 side by side', async ({ page }) => {
    await open(page, 'mixed.pdf');
    await twoPages(page);
    await expect
      .poll(async () => {
        const [p1, p2] = (await rects(page, 1, 2)).pages;
        return !!p1 && !!p2 && p2.left > p1.right && Math.abs(centerY(p1) - centerY(p2)) <= 1;
      })
      .toBe(true);
    const { pages } = await rects(page, 1, 2, 3);
    expect(pages[2]!.top).toBeGreaterThan(pages[0]!.bottom);
  });

  test('→ and ← move one row and the indicator shows the row', async ({ page }) => {
    await open(page, 'mixed.pdf');
    await twoPages(page);
    await waitForPairs(page);
    expect((await state(page)).currentPage).toBe(1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(page)).currentPage).toBe(3);
    await expect(page.locator('input[data-page-input]')).toHaveValue('3');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await state(page)).currentPage).toBe(1);
  });

  test('scrolling shows the left page of the most visible row', async ({ page }) => {
    await open(page, 'long300.pdf');
    await twoPages(page);
    await waitForPairs(page);
    // Put row 6 (pages 11 and 12) at the top of the viewport by scrolling, not by navigation.
    await page.evaluate(() => {
      const pfw = (window as any).__pfw;
      const layout = pfw.viewer.getLayout();
      document.getElementById('viewer')!.scrollTop = layout.rows[5].top - layout.padding;
    });
    await expect.poll(async () => (await state(page)).currentPage).toBe(11);
  });

  test('the page field scrolls to the row of the page', async ({ page }) => {
    await open(page, 'long300.pdf');
    await twoPages(page);
    await waitForPairs(page);
    const input = page.locator('input[data-page-input]');
    await input.focus();
    await input.fill('10');
    await input.press('Enter');
    const viewerTop = await page.evaluate(() => document.getElementById('viewer')!.getBoundingClientRect().top);
    await expect
      .poll(async () => {
        const [p9, p10] = (await rects(page, 9, 10)).pages;
        return p9 && p10 ? [Math.round(p9.top - viewerTop), Math.round(p10.top - viewerTop)] : null;
      })
      .toEqual([PADDING, PADDING]);
  });

  test('Fit Width makes the row fill the width minus padding', async ({ page }) => {
    await open(page, 'simple.pdf');
    await twoPages(page);
    await page.evaluate(() => (window as any).__pfw.viewer.setZoom('fit-width'));
    await expect
      .poll(async () => {
        const { layer, pages } = await rects(page, 1, 2);
        const [p1, p2] = pages;
        if (!p1 || !p2) return null;
        return [Math.round(p1.left - layer.left), Math.round(layer.right - p2.right)];
      })
      .toEqual([PADDING, PADDING]);
    const overflow = await page.evaluate(() => {
      const v = document.getElementById('viewer')!;
      return v.scrollWidth - v.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('book mode shows page 1 alone on the right', async ({ page }) => {
    await open(page, 'simple.pdf');
    await twoPages(page, true);
    await expect
      .poll(async () => {
        const { layer, pages } = await rects(page, 1, 2, 3);
        const [p1, p2, p3] = pages;
        if (!p1 || !p2 || !p3) return null;
        const spine = (layer.left + layer.right) / 2;
        return {
          coverRight: p1.left >= spine,
          alone: p2.top > p1.bottom,
          spread: p3.left > p2.right && Math.abs(centerY(p2) - centerY(p3)) <= 1,
        };
      })
      .toEqual({ coverRight: true, alone: true, spread: true });
  });

  test('rotation keeps the pages side by side', async ({ page }) => {
    await open(page, 'simple.pdf');
    await twoPages(page);
    await page.evaluate(() => (window as any).__pfw.viewer.setRotation(90));
    await expect
      .poll(async () => {
        const [p1, p2] = (await rects(page, 1, 2)).pages;
        return !!p1 && !!p2 && p1.width > p1.height && p2.left > p1.right && Math.abs(centerY(p1) - centerY(p2)) <= 1;
      })
      .toBe(true);
  });

  test('ctrl+wheel keeps the point under the cursor on the right page', async ({ page }) => {
    await open(page, 'long300.pdf');
    await twoPages(page);
    await waitForPairs(page);
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(10));
    await page.waitForSelector('#viewer .page[data-page="12"] canvas[data-rendered="true"]');
    const before = (await rects(page, 12)).pages[0]!;
    const x = before.left + 0.3 * before.width;
    const y = before.top + 0.4 * before.height;
    const scale = (await state(page)).scale;
    await page.mouse.move(x, y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await state(page)).scale).toBeGreaterThan(scale);
    const after = (await rects(page, 12)).pages[0]!;
    expect(after.width).toBeGreaterThan(before.width);
    expect(Math.abs(after.left + 0.3 * after.width - x)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.top + 0.4 * after.height - y)).toBeLessThanOrEqual(2);
  });

  test('keeps at most 12 pages mounted while scrolling a long document', async ({ page }) => {
    await open(page, 'long300.pdf');
    await twoPages(page);
    await waitForPairs(page);
    let most = 0;
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => document.getElementById('viewer')!.scrollBy(0, 700));
      await page.waitForTimeout(30);
      const n = await page.evaluate(() => ({
        pages: document.querySelectorAll('#viewer .page').length,
        canvases: document.querySelectorAll('#viewer .page canvas').length,
      }));
      most = Math.max(most, n.pages, n.canvases);
    }
    expect(most).toBeGreaterThan(2);
    expect(most).toBeLessThanOrEqual(12);
    expect((await state(page)).currentPage).toBeGreaterThan(20);
  });

  test('page views follow the pages into their new positions', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => {
      const w = window as any;
      w.__views = [];
      w.__pfw.viewer.onPageView((v: any) => w.__views.push({ index: v.index, width: v.viewport.width, el: v.el }));
    });
    await twoPages(page);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const views = (window as any).__views as { index: number; width: number; el: HTMLElement }[];
          const last = views.filter((v) => v.index === 1).at(-1);
          if (!last) return null;
          const r = last.el.getBoundingClientRect();
          const p1 = document.querySelector('#viewer .page[data-page="1"]')!.getBoundingClientRect();
          return { sameWidth: Math.abs(r.width - last.width) < 1, beside: r.left > p1.right, page: last.el.dataset['page'] };
        }),
      )
      .toEqual({ sameWidth: true, beside: true, page: '2' });
  });

  test('clicking the right page of a row keeps it selected', async ({ page }) => {
    await open(page, 'simple.pdf');
    await twoPages(page);
    await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
    await page.waitForSelector('#sidebar .thumb[data-page="2"] canvas[data-rendered="true"]');
    // The narrower viewer re-fits after a debounce; until then → would pan instead of paging.
    await expect.poll(() => page.evaluate(() => (window as any).__pfw.viewer.overflowsHorizontally())).toBe(false);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(page)).currentPage).toBe(3);
    await page.locator('#sidebar .thumb[data-page="2"]').click();
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
    await expect(page.locator('#sidebar .thumb.selected')).toHaveAttribute('data-page', '2');
    await expect(page.locator('#sidebar .thumb.current')).toHaveAttribute('data-page', '2');
  });
});
