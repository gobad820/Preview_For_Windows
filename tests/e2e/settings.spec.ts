import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
}

/** Opens `name` in the running window, the way File › Open does. */
async function openInPlace(page: Page, name: string) {
  await page.evaluate((n) => (window as any).__pfw.app.openPath(`fixtures/${n}`), name);
  await page.waitForFunction((n) => {
    const s = (window as any).__pfw.store.get();
    return s.status === 'ready' && s.fileName === n;
  }, name);
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfw.settings') ?? 'null'));
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const tab = (page: Page, name: string) => settings(page).getByRole('tab', { name });

async function openSettings(page: Page, pane?: string) {
  await page.keyboard.press('Control+Comma');
  await expect(settings(page)).toBeVisible();
  if (pane) await tab(page, pane).click();
}

test.describe('Settings window', () => {
  test('Ctrl+, opens it; Esc closes it and gives focus back', async ({ page }) => {
    await open(page, 'simple.pdf');
    const sidebarButton = page.locator('#toolbar [data-action="sidebar"]');
    await sidebarButton.focus();
    await page.keyboard.press('Control+Comma');
    await expect(settings(page)).toBeVisible();
    await expect(tab(page, 'General')).toHaveAttribute('aria-selected', 'true');
    expect(await settings(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
    await expect(sidebarButton).toBeFocused();
  });

  test('Settings… runs from the command registry, and a second request does not stack windows', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__pfw.app.commands.run('app.preferences'));
    await expect(settings(page)).toBeVisible();
    await page.evaluate(() => (window as any).__pfw.app.commands.run('app.preferences'));
    await page.keyboard.press('Control+Comma');
    await expect(settings(page)).toHaveCount(1);
  });

  test('the close button closes it', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(settings(page)).toHaveCount(0);
  });

  test('the toolbar switches panes and the title follows', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    const title = settings(page).locator('.settings-title');
    await expect(title).toHaveText('General');
    await expect(settings(page).getByLabel('Default zoom')).toBeVisible();
    await tab(page, 'Markup').click();
    await expect(tab(page, 'Markup')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'General')).toHaveAttribute('aria-selected', 'false');
    await expect(title).toHaveText('Markup');
    await expect(settings(page).getByLabel('Line width')).toBeVisible();
    await expect(settings(page).getByLabel('Default zoom')).toBeHidden();
    // Arrow keys move along the toolbar, like tabs.
    await tab(page, 'Markup').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Window')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Window')).toBeFocused();
    await expect(title).toHaveText('Window');
    // It reopens on the pane it was left on.
    await page.keyboard.press('Escape');
    await openSettings(page);
    await expect(title).toHaveText('Window');
  });

  test('is modal: keys, clicks and Tab stay inside', async ({ page }) => {
    await open(page, 'long300.pdf');
    await openSettings(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+f');
    const s = await state(page);
    expect(s.currentPage).toBe(1);
    expect(s.findOpen).toBe(false);
    // A press on the document behind does nothing and does not take focus.
    await page.mouse.click(600, 700);
    await expect(settings(page)).toBeVisible();
    expect(await settings(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      expect(await settings(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });

  test('pop-up buttons work from the keyboard; Esc closes an open pop-up before the window', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    const zoom = settings(page).getByLabel('Default zoom');
    await zoom.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => zoom.evaluate((el) => el.matches(':open'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => zoom.evaluate((el) => el.matches(':open'))).toBe(false);
    await expect(settings(page)).toBeVisible();

    await zoom.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => zoom.evaluate((el) => el.matches(':open'))).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(zoom).toHaveValue('fit-page');
    expect((await stored(page)).defaultZoom).toBe('fit-page');
    await expect(settings(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
  });

  test('Ctrl+W closes Settings, not the window', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    await page.keyboard.press('Control+w');
    await expect(settings(page)).toHaveCount(0);
  });

  test('stays light in the dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await openSettings(page);
    const bg = await settings(page).locator('.settings-pane:not([hidden])').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(236, 236, 236)');
  });
});

test.describe('General', () => {
  test('default zoom applies to files without a remembered position, and is remembered', async ({ page }) => {
    await open(page, 'simple.pdf');
    await openSettings(page);
    await settings(page).getByLabel('Default zoom').selectOption('fit-page');
    expect((await stored(page)).defaultZoom).toBe('fit-page');
    await page.keyboard.press('Escape');
    await openInPlace(page, 'mixed.pdf');
    expect((await state(page)).zoomMode).toBe('fit-page');

    await openSettings(page);
    await settings(page).getByLabel('Default zoom').selectOption('actual-size');
    // A file opened for the first time, after a relaunch.
    await open(page, 'outline.pdf');
    expect(await state(page)).toMatchObject({ zoomMode: 'custom', scale: 1 });
    await openSettings(page);
    await expect(settings(page).getByLabel('Default zoom')).toHaveValue('actual-size');
  });

  test('a remembered position wins over the default zoom', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.keyboard.press('Control+2');
    await expect.poll(async () => (await state(page)).zoomMode).toBe('fit-page');
    await page.waitForTimeout(500); // debounced save
    await openSettings(page);
    await settings(page).getByLabel('Default zoom').selectOption('actual-size');
    await page.reload();
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    expect((await state(page)).zoomMode).toBe('fit-page');
  });

  test('page layout applies at once and follows the View menu', async ({ page }) => {
    await open(page, 'simple.pdf');
    await openSettings(page);
    const layout = settings(page).getByLabel('Page layout');
    const book = settings(page).getByLabel('Book Mode');
    await expect(layout).toHaveValue('continuous');
    await expect(book).toBeDisabled();
    await layout.selectOption('two-pages');
    expect((await state(page)).displayMode).toBe('two-pages');
    await expect(book).toBeEnabled();
    await book.check();
    expect((await state(page)).bookMode).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as any).__pfw.viewer.getLayout().rows[0]?.last)).toBe(0);

    // The View menu changes the same setting.
    await page.evaluate(() => (window as any).__pfw.app.commands.run('view.continuous'));
    expect((await stored(page)).displayMode).toBe('continuous');
    await openSettings(page);
    await expect(layout).toHaveValue('continuous');
    await expect(book).toBeChecked();
    await expect(book).toBeDisabled();
  });

  test("an earlier version's saved page layout carries over", async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('pfw.view', JSON.stringify({ displayMode: 'two-pages', bookMode: true }));
    });
    await open(page, 'simple.pdf');
    expect(await state(page)).toMatchObject({ displayMode: 'two-pages', bookMode: true });
    expect(await stored(page)).toMatchObject({ displayMode: 'two-pages', bookMode: true });
    await openSettings(page);
    await expect(settings(page).getByLabel('Page layout')).toHaveValue('two-pages');
  });

  test('show the sidebar when a document opens', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    const check = settings(page).getByLabel('Show the sidebar when a document opens');
    await expect(check).not.toBeChecked();
    await check.check();
    await page.keyboard.press('Escape');
    expect((await state(page)).sidebarOpen).toBe(false);
    await openInPlace(page, 'simple.pdf');
    expect((await state(page)).sidebarOpen).toBe(true);
    await expect(page.locator('#sidebar')).toBeVisible();
  });

  test('remembering positions can be turned off, which forgets them', async ({ page }) => {
    await open(page, 'long300.pdf');
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(41));
    await expect.poll(async () => (await state(page)).currentPage).toBe(42);
    await page.waitForTimeout(500); // debounced save
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('pfw:file:')))).toBe(true);

    await openSettings(page);
    const remember = settings(page).getByLabel("Remember each file's last page and zoom");
    await expect(remember).toBeChecked();
    await remember.uncheck();
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('pfw:file:')))).toBe(false);
    await page.keyboard.press('Escape');

    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(99));
    await expect.poll(async () => (await state(page)).currentPage).toBe(100);
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    expect((await state(page)).currentPage).toBe(1);
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('pfw:file:')))).toBe(false);

    // On again: positions are saved and restored again.
    await openSettings(page);
    await settings(page).getByLabel("Remember each file's last page and zoom").check();
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__pfw.viewer.goToPage(9));
    await expect.poll(async () => (await state(page)).currentPage).toBe(10);
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    await expect.poll(async () => (await state(page)).currentPage).toBe(10);
  });
});

test.describe('Markup', () => {
  const styles = (page: Page) =>
    page.evaluate(() => {
      const s = (window as any).__pfw.markup.state;
      return { ...s.styles, highlight: s.markColorFor('highlight') };
    });

  test('sets the markup defaults, which the markup toolbar shows and a reload keeps', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.click('#toolbar [data-action="markup"]');
    await openSettings(page, 'Markup');
    const pane = settings(page);
    await expect(pane.getByLabel('Line width')).toHaveValue('2');
    await expect(pane.getByLabel('Text size')).toHaveValue('12');
    await pane.getByLabel('Highlight color').selectOption({ label: 'Blue' });
    await pane.getByLabel('Shape color').selectOption({ label: 'Purple' });
    await pane.getByLabel('Line width').selectOption({ label: '5 pt' });
    await pane.getByLabel('Text size').selectOption({ label: '24 pt' });
    expect(await styles(page)).toMatchObject({ highlight: '#8ac4ff', stroke: '#af52de', width: 5, fontSize: 24, markKind: 'highlight' });
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-markup="stroke"]').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--swatch'))).toBe('#af52de');

    await page.reload();
    await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
    expect(await styles(page)).toMatchObject({ highlight: '#8ac4ff', stroke: '#af52de', width: 5, fontSize: 24 });
    await openSettings(page, 'Markup');
    await expect(settings(page).getByLabel('Highlight color')).toHaveValue('#8ac4ff');
    await expect(settings(page).getByLabel('Shape color')).toHaveValue('#af52de');
  });

  test('shows changes made on the markup toolbar', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.markup.state.setStyles({ width: 8, stroke: '#007aff' }));
    await openSettings(page, 'Markup');
    await expect(settings(page).getByLabel('Line width')).toHaveValue('8');
    await expect(settings(page).getByLabel('Shape color')).toHaveValue('#007aff');
  });
});

test.describe('Window', () => {
  test('show the menu bar follows View › Menu Bar and is remembered', async ({ page }) => {
    await page.goto('/');
    await openSettings(page, 'Window');
    const check = settings(page).getByLabel('Show the menu bar');
    await expect(check).toBeChecked();
    await check.uncheck();
    expect((await state(page)).menuBarVisible).toBe(false);
    await page.keyboard.press('Escape');

    await page.reload();
    await page.waitForFunction(() => !!(window as any).__pfw);
    expect((await state(page)).menuBarVisible).toBe(false);

    await page.evaluate(() => (window as any).__pfw.app.commands.run('view.menuBar'));
    expect((await stored(page)).menuBarVisible).toBe(true);
    await openSettings(page, 'Window');
    await expect(settings(page).getByLabel('Show the menu bar')).toBeChecked();
  });
});
