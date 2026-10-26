import { expect, test, type Page } from '@playwright/test';

const SIDEBAR_WIDTH = 220;

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => {
    const s = (window as any).__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error');
  });
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
const setState = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((p) => (window as any).__pfw.store.set(p), patch);
const goToPage = (page: Page, index: number) =>
  page.evaluate((i) => (window as any).__pfw.viewer.goToPage(i), index);
const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

/** Thumbnail canvases that hold pixels (unrendered ones are released to 0×0). */
const renderedThumbs = (page: Page) =>
  page.evaluate(
    () => Array.from(document.querySelectorAll<HTMLCanvasElement>('#sidebar .thumb canvas')).filter((c) => c.width > 0).length,
  );

/** True when the element is fully inside its sidebar panel's scroll viewport. */
const inPanelView = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const panel = el?.closest('.sidebar-panel');
    if (!el || !panel) return false;
    const r = el.getBoundingClientRect();
    const v = panel.getBoundingClientRect();
    return r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
  }, selector);

async function openSidebar(page: Page) {
  await setState(page, { sidebarOpen: true });
  await expect(page.locator('#sidebar')).toBeVisible();
}

test.describe('sidebar', () => {
  test('is hidden until sidebarOpen, is 220px wide and re-fits the viewer', async ({ page }) => {
    await open(page, 'simple.pdf');
    const aside = page.locator('#sidebar');
    await expect(aside).toBeHidden();
    const before = (await state(page)).scale;
    expect((await state(page)).zoomMode).toBe('fit-width');
    await openSidebar(page);
    expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(SIDEBAR_WIDTH);
    await expect.poll(async () => (await state(page)).scale).toBeLessThan(before);
    await setState(page, { sidebarOpen: false });
    await expect(aside).toBeHidden();
    await expect.poll(async () => (await state(page)).scale).toBe(before);
  });

  test('lists one thumbnail per page and renders only the visible ones', async ({ page }) => {
    await open(page, 'long300.pdf');
    await openSidebar(page);
    await expect(page.locator('#sidebar .thumb')).toHaveCount(300);
    await expect(page.locator('#sidebar .thumb[data-page="1"]')).toHaveClass(/current/);
    await page.waitForSelector('#sidebar .thumb[data-page="1"] canvas[data-rendered="true"]');
    const rendered = await renderedThumbs(page);
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(40);
    // thumbnails are 160px wide and keep the page aspect ratio (A4 portrait)
    const box = await page.locator('#sidebar .thumb[data-page="1"] canvas').boundingBox();
    expect(Math.round(box!.width)).toBe(160);
    expect(box!.height).toBeGreaterThan(box!.width);
  });

  test('clicking a thumbnail navigates and focuses the page list, like Preview', async ({ page }) => {
    await open(page, 'long300.pdf');
    await openSidebar(page);
    await page.locator('#viewer').focus();
    expect(await activeId(page)).toBe('viewer');
    await page.locator('#sidebar .thumb[data-page="42"]').click();
    await expect.poll(async () => (await state(page)).currentPage).toBe(42);
    await expect(page.locator('#sidebar .thumb.current')).toHaveAttribute('data-page', '42');
    await expect(page.locator('#sidebar .thumb.selected')).toHaveAttribute('data-page', '42');
    // Focus sits on the list (so Delete and Ctrl+C act on pages), never on a single thumbnail.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('listbox');
    expect(await page.evaluate(() => document.querySelector('#sidebar .thumb')?.getAttribute('tabindex'))).toBe('-1');
  });

  test('current thumbnail follows the viewer and stays in view', async ({ page }) => {
    await open(page, 'long300.pdf');
    await openSidebar(page);
    await goToPage(page, 199);
    await expect.poll(async () => (await state(page)).currentPage).toBe(200);
    await expect(page.locator('#sidebar .thumb.current')).toHaveAttribute('data-page', '200');
    await expect.poll(() => inPanelView(page, '#sidebar .thumb.current')).toBe(true);
    await page.waitForSelector('#sidebar .thumb[data-page="200"] canvas[data-rendered="true"]');
    expect(await renderedThumbs(page)).toBeLessThan(40);
  });

  test('scrolls the current thumbnail into view when opened later', async ({ page }) => {
    await open(page, 'long300.pdf');
    await goToPage(page, 149);
    await expect.poll(async () => (await state(page)).currentPage).toBe(150);
    expect(await renderedThumbs(page)).toBe(0);
    await openSidebar(page);
    await expect(page.locator('#sidebar .thumb.current')).toHaveAttribute('data-page', '150');
    await expect.poll(() => inPanelView(page, '#sidebar .thumb.current')).toBe(true);
  });

  test('outline tab shows the outline, expands sections and navigates', async ({ page }) => {
    await open(page, 'outline.pdf');
    await openSidebar(page);
    const outlineTab = page.locator('#sidebar button[data-tab="outline"]');
    const thumbsTab = page.locator('#sidebar button[data-tab="thumbnails"]');
    await expect(thumbsTab).toHaveClass(/active/);
    await expect(outlineTab).toBeEnabled();
    await page.locator('#viewer').focus();
    await outlineTab.click();
    expect((await state(page)).sidebarTab).toBe('outline');
    await expect(outlineTab).toHaveClass(/active/);
    expect(await activeId(page)).toBe('viewer');

    const chapter = page.getByRole('button', { name: 'Chapter 1', exact: true });
    const section = page.getByRole('button', { name: 'Section 1.1', exact: true });
    await expect(chapter).toBeVisible();
    await expect(chapter).toHaveAttribute('data-page', '1');
    await expect(page.getByRole('button', { name: 'Appendix', exact: true })).toBeVisible();
    // Top-level chapters start expanded so their sections are one click away.
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute('data-page', '2');

    await page.getByRole('button', { name: 'Collapse Chapter 1' }).click();
    await expect(section).toBeHidden();
    await page.getByRole('button', { name: 'Expand Chapter 1' }).click();
    await expect(section).toBeVisible();
    await section.click();
    await expect.poll(async () => (await state(page)).currentPage).toBe(2);
    expect(await activeId(page)).toBe('viewer');

    await thumbsTab.click();
    expect((await state(page)).sidebarTab).toBe('thumbnails');
    await expect(page.locator('#sidebar .thumb.current')).toHaveAttribute('data-page', '2');
  });

  test('outline tab is disabled for a document without an outline', async ({ page }) => {
    await open(page, 'simple.pdf');
    await openSidebar(page);
    const outlineTab = page.locator('#sidebar button[data-tab="outline"]');
    await expect(outlineTab).toBeDisabled();
    await expect(outlineTab).toHaveAttribute('title', 'No outline');
    await expect(page.locator('#sidebar button[data-tab="thumbnails"]')).toHaveClass(/active/);
    await expect(page.locator('#sidebar .thumb')).toHaveCount(3);
  });

  test('exposes the sidebar on window.__pfw', async ({ page }) => {
    await open(page, 'simple.pdf');
    expect(await page.evaluate(() => typeof (window as any).__pfw.sidebar?.setDocument)).toBe('function');
  });
});
