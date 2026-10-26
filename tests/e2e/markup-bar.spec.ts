import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name = 'simple.pdf') {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__pfw.markup.state;
    return { tool: s.tool, highlightMode: s.highlightMode, styles: s.styles };
  });

const pressed = (page: Page) =>
  page.$$eval('#markupbar [data-markup][aria-pressed="true"]', (els) => els.map((e) => (e as HTMLElement).dataset['markup']));

test('Ctrl+Shift+A shows the markup toolbar with its controls in Preview order', async ({ page }) => {
  await open(page);
  await page.locator('#viewer').focus();
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('#markupbar')).toBeVisible();
  await expect(page.locator('#toolbar [data-action="markup"]')).toHaveAttribute('aria-pressed', 'true');
  const order = await page.$$eval('#markupbar [data-markup]', (els) => els.map((e) => (e as HTMLElement).dataset['markup']));
  expect(order).toEqual([
    'select',
    'draw',
    'shapes',
    'text',
    'note',
    'separator',
    'highlight',
    'highlight-menu',
    'separator',
    'width',
    'stroke',
    'fill',
    'text-style',
  ]);
  for (const b of await page.locator('#markupbar button[data-markup]').all()) {
    expect(await b.getAttribute('title')).toBeTruthy();
  }
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('#markupbar')).toBeHidden();
});

test('tool buttons show the armed tool: Draw toggles, Shapes picks a shape', async ({ page }) => {
  await open(page);
  await page.click('#toolbar [data-action="markup"]');
  expect(await pressed(page)).toEqual(['select']);
  await page.click('[data-markup="draw"]');
  expect(await pressed(page)).toEqual(['draw']);
  expect((await state(page)).tool).toBe('draw');
  await page.click('[data-markup="draw"]');
  expect(await pressed(page)).toEqual(['select']);

  await page.click('[data-markup="shapes"]');
  const labels = await page.$$eval('.menu .menu-label', (els) => els.map((e) => e.textContent));
  expect(labels).toEqual(['Line', 'Arrow', 'Rectangle', 'Rounded Rectangle', 'Oval']);
  expect(await page.locator('.menu .menu-item svg').count()).toBeGreaterThanOrEqual(5);
  await page.click('.menu-item:has-text("Oval")');
  expect((await state(page)).tool).toBe('oval');
  expect(await pressed(page)).toEqual(['shapes']);
  await page.click('[data-markup="text"]');
  expect((await state(page)).tool).toBe('text');
  await page.click('[data-markup="note"]');
  expect((await state(page)).tool).toBe('note');
  await page.click('[data-markup="select"]');
  expect((await state(page)).tool).toBe('select');
});

test('the highlight menu picks colors and kinds; both swatches follow', async ({ page }) => {
  await open(page);
  await page.click('#toolbar [data-action="markup"]');
  await page.click('#toolbar [data-action="highlight-menu"]');
  const labels = await page.$$eval('.menu .menu-label', (els) => els.map((e) => e.textContent));
  expect(labels).toEqual(['Yellow', 'Green', 'Blue', 'Pink', 'Purple', 'Underline', 'Strikethrough']);
  await expect(page.locator('.menu-item[aria-checked="true"]')).toHaveText('Yellow');
  await page.click('.menu-item:has-text("Green")');

  const swatches = () =>
    page.$$eval('[data-highlight-swatch]', (els) =>
      els.map((e) => ({ color: (e as HTMLElement).style.getPropertyValue('--swatch'), kind: (e as HTMLElement).dataset['kind'] })),
    );
  expect(await swatches()).toEqual([
    { color: '#8ee07a', kind: 'highlight' },
    { color: '#8ee07a', kind: 'highlight' },
  ]);
  // Picking a style turns highlight mode on, like Preview.
  await expect(page.locator('#toolbar [data-action="highlight"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#markupbar [data-markup="highlight"]')).toHaveAttribute('aria-pressed', 'true');

  await page.click('#markupbar [data-markup="highlight-menu"]');
  await page.click('.menu-item:has-text("Underline")');
  expect(await swatches()).toEqual([
    { color: '#ff3b30', kind: 'underline' },
    { color: '#ff3b30', kind: 'underline' },
  ]);
  expect((await state(page)).styles).toMatchObject({ markKind: 'underline', markColor: '#ff3b30' });
});

test('the highlight button toggles highlight mode when no text is selected', async ({ page }) => {
  await open(page);
  const button = page.locator('#toolbar [data-action="highlight"]');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect((await state(page)).highlightMode).toBe(true);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).highlightMode).toBe(false);
});

test('style controls set the defaults and they are remembered after a reload', async ({ page }) => {
  await open(page);
  await page.click('#toolbar [data-action="markup"]');

  await page.click('[data-markup="width"]');
  const widths = await page.$$eval('.menu .menu-label', (els) => els.map((e) => e.textContent));
  expect(widths).toEqual(['0.5 pt', '1 pt', '2 pt', '3 pt', '5 pt', '8 pt']);
  await expect(page.locator('.menu-item[aria-checked="true"]')).toHaveText('2 pt');
  await page.getByRole('menuitemradio', { name: '5 pt', exact: true }).click();
  expect((await state(page)).styles.width).toBe(5);

  await page.click('[data-markup="stroke"]');
  const palette = page.locator('.markup-palette');
  await expect(palette).toBeVisible();
  expect(await palette.locator('[data-color]').count()).toBe(12);
  await palette.locator('[data-color="#007aff"]').click();
  await expect(palette).toBeHidden();
  expect((await state(page)).styles.stroke).toBe('#007aff');
  expect(await page.locator('[data-markup="stroke"]').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--swatch'))).toBe(
    '#007aff',
  );

  await page.click('[data-markup="fill"]');
  await palette.locator('[data-color="#34c759"]').click();
  expect((await state(page)).styles.fill).toBe('#34c759');
  await page.click('[data-markup="fill"]');
  await palette.locator('[data-no-fill]').click();
  expect((await state(page)).styles.fill).toBe(null);

  await page.click('[data-markup="text-style"]');
  await expect(palette.locator('[data-font-size]')).toHaveText('12 pt');
  await palette.locator('[data-size-step="1"]').click();
  await expect(palette.locator('[data-font-size]')).toHaveText('14 pt');
  await palette.locator('[data-color="#af52de"]').click();
  expect((await state(page)).styles).toMatchObject({ fontSize: 14, textColor: '#af52de' });
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
  expect((await state(page)).styles).toMatchObject({ width: 5, stroke: '#007aff', fill: null, fontSize: 14, textColor: '#af52de' });
});

test('Escape disarms a tool before it closes find', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#findbar')).toBeVisible();
  await page.click('#toolbar [data-action="markup"]');
  await page.click('[data-markup="draw"]');
  await page.locator('#viewer').focus();
  await page.keyboard.press('Escape');
  expect((await state(page)).tool).toBe('select');
  await expect(page.locator('#findbar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#findbar')).toBeHidden();
});
