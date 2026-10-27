import { expect, test, type Locator, type Page } from '@playwright/test';

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

/** What `prop: value` computes to on a bare element, so theme tokens resolve as the page has them. */
const resolved = (page: Page, prop: string, value: string) =>
  page.evaluate(
    ([prop, value]) => {
      const el = document.createElement('div');
      el.style.setProperty(prop, value);
      document.body.append(el);
      const out = getComputedStyle(el).getPropertyValue(prop);
      el.remove();
      return out;
    },
    [prop, value] as const,
  );
const css = (loc: Locator, prop: string, pseudo?: string) =>
  loc.evaluate((el, [prop, pseudo]) => getComputedStyle(el, pseudo).getPropertyValue(prop), [prop, pseudo ?? null] as const);

/** The computed look of the app's own menus (src/ui/menu.ts), with a focused (highlighted) row. */
const menuLook = (page: Page) =>
  page.evaluate(() => {
    const menu = document.createElement('div');
    menu.className = 'menu';
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.tabIndex = -1;
    const check = document.createElement('span');
    check.className = 'menu-check';
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = 'Item';
    item.append(check, label);
    menu.append(item);
    document.body.append(menu);
    item.focus();
    const m = getComputedStyle(menu);
    const i = getComputedStyle(item);
    const look = {
      background: m.backgroundColor,
      backdrop: m.backdropFilter,
      radius: m.borderRadius,
      shadow: m.boxShadow,
      padding: m.padding,
      borderWidth: m.borderTopWidth,
      fontFamily: i.fontFamily,
      fontSize: i.fontSize,
      color: m.color,
      itemHeight: i.height,
      itemRadius: i.borderRadius,
      highlight: i.backgroundColor,
      highlightText: i.color,
      labelInset: label.getBoundingClientRect().left - item.getBoundingClientRect().left,
    };
    menu.remove();
    return look;
  });

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

});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Look, ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
    });

    test('the window is a modern panel in the toolbar colours, over the scrim', async ({ page }) => {
      await page.goto('/');
      await openSettings(page);
      const win = settings(page);
      const chrome = await resolved(page, 'background-color', 'var(--chrome-bg)');
      expect(await css(win, 'background-color')).toBe(chrome);
      expect(await css(page.locator('#toolbar'), 'background-color')).toBe(chrome);
      expect(await css(win, 'border-radius')).toBe(await resolved(page, 'border-radius', 'var(--radius-alert)'));
      expect(await css(win, 'box-shadow')).toContain(await resolved(page, 'box-shadow', 'var(--menu-ring)'));
      expect(await css(win, 'font-family')).toContain('Inter');
      expect(await css(win, 'font-family')).not.toContain('Lucida');
      expect(await css(win, 'color')).toBe(await resolved(page, 'color', 'var(--text)'));
      expect(await css(page.locator('.settings-scrim'), 'background-color')).toBe(await resolved(page, 'background-color', 'var(--scrim)'));

      // Title bar and tab toolbar are one surface; only the toolbar draws the app toolbar's hairline.
      const titlebar = win.locator('.settings-titlebar');
      expect(await css(titlebar, 'background-image')).toBe('none');
      expect(await css(titlebar, 'box-shadow')).toBe('none');
      const toolbar = win.locator('.settings-toolbar');
      expect(await css(toolbar, 'background-image')).toBe('none');
      expect(await css(toolbar, 'box-shadow')).toBe(await css(page.locator('#toolbar'), 'box-shadow'));

      const title = win.locator('.settings-title');
      expect(await css(title, 'font-size')).toBe('13px');
      expect(await css(title, 'font-weight')).toBe('600');
      expect(await css(title, 'color')).toBe(await resolved(page, 'color', 'var(--text)'));
      expect(await css(title, 'text-shadow')).toBe('none');
      const [wb, tb] = [await win.boundingBox(), await title.boundingBox()];
      expect(Math.abs(tb!.x + tb!.width / 2 - (wb!.x + wb!.width / 2))).toBeLessThan(1);
    });

    test('flat traffic lights: a red close button, the other two grey and inert', async ({ page }) => {
      await page.goto('/');
      await openSettings(page);
      const lights = settings(page).locator('.settings-light');
      await expect(lights).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        const box = await lights.nth(i).boundingBox();
        expect([box!.width, box!.height]).toEqual([12, 12]);
        expect(await css(lights.nth(i), 'border-radius')).toBe('50%');
        expect(await css(lights.nth(i), 'background-image')).toBe('none');
      }
      const close = settings(page).getByRole('button', { name: 'Close' });
      expect(await css(close, 'background-color')).toBe('rgb(255, 95, 87)');
      for (const i of [1, 2]) {
        expect(await css(lights.nth(i), 'background-color')).not.toBe('rgb(255, 95, 87)');
        await expect(lights.nth(i)).toHaveAttribute('aria-hidden', 'true');
        expect(await lights.nth(i).evaluate((el) => (el as HTMLElement).tabIndex)).toBe(-1);
      }
    });

    test('toolbar tabs: grey line icons with labels; the selected one in the accent on a pressed fill', async ({ page }) => {
      await page.goto('/');
      await openSettings(page);
      const icon = await resolved(page, 'color', 'var(--icon)');
      const accent = await resolved(page, 'color', 'var(--accent)');
      const selected = tab(page, 'General');
      const other = tab(page, 'Markup');
      for (const t of [selected, other, tab(page, 'Window')]) {
        const svg = t.locator('svg');
        expect(await svg.getAttribute('stroke')).toBe('currentColor');
        expect((await svg.boundingBox())!.width).toBe(22);
        expect(await css(t.locator('.settings-tab-label'), 'font-size')).toBe('11px');
        expect(await css(t, 'font-family')).toContain('Inter');
      }
      expect(await css(other.locator('svg'), 'color')).toBe(icon);
      expect(await css(other, 'background-color')).toBe('rgba(0, 0, 0, 0)');
      expect(await css(selected.locator('svg'), 'color')).toBe(accent);
      expect(await css(selected.locator('.settings-tab-label'), 'color')).toBe(accent);
      expect(await css(selected, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--fill-pressed)'));
      expect(await css(selected, 'border-radius')).toBe('6px');
      expect(await css(selected, 'background-image')).toBe('none');
      await other.hover();
      await expect.poll(() => css(other, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--fill-hover)'));
      // Keyboard focus shows the app's focus ring.
      await selected.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      expect(await css(selected, 'box-shadow')).toContain(await resolved(page, 'box-shadow', 'var(--focus-ring)'));
    });

    test('pop-up buttons: a macOS pop-up whose open list looks like the app menus', async ({ page }) => {
      await page.goto('/');
      const menu = await menuLook(page);
      await openSettings(page);
      const zoom = settings(page).getByLabel('Default zoom');
      const box = (await zoom.boundingBox())!;
      expect(box.height).toBe(22);
      const radius = parseFloat(await css(zoom, 'border-radius'));
      expect(radius).toBeGreaterThanOrEqual(5);
      expect(radius).toBeLessThanOrEqual(6);
      expect(await css(zoom, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--control-bg)'));
      expect(await css(zoom, 'background-image')).toBe('none');
      expect(await css(zoom, 'box-shadow')).toBe(await resolved(page, 'box-shadow', 'var(--control-shadow)'));
      expect(await css(zoom, 'font-family')).toContain('Inter');
      expect(await css(zoom, 'font-size')).toBe('13px');

      // Value on the left; an accent square with white chevrons on the right.
      const value = zoom.locator('selectedcontent');
      await expect(value).toHaveText('Fit Width');
      const arrows = zoom.locator('.settings-popup-arrows');
      const a = (await arrows.boundingBox())!;
      expect(await css(arrows, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--accent)'));
      expect(await css(arrows, 'color')).toBe(await resolved(page, 'color', 'var(--accent-fg)'));
      expect(a.width).toBe(a.height);
      expect(box.x + box.width - (a.x + a.width)).toBeLessThanOrEqual(4);
      expect((await value.boundingBox())!.x + 1).toBeLessThan(a.x);
      await expect(arrows.locator('svg')).toHaveCount(1);

      await zoom.focus();
      expect(await css(zoom, 'box-shadow')).toContain(await resolved(page, 'box-shadow', 'var(--focus-ring)'));
      await page.keyboard.press('Enter');
      await expect.poll(() => zoom.evaluate((el) => el.matches(':open'))).toBe(true);
      const picker = (prop: string) => css(zoom, prop, '::picker(select)');
      expect(await picker('background-color')).toBe(menu.background);
      expect(await picker('backdrop-filter')).toBe(menu.backdrop);
      expect(await picker('border-radius')).toBe(menu.radius);
      expect(await picker('box-shadow')).toBe(menu.shadow);
      expect(await picker('padding')).toBe(menu.padding);
      expect(await picker('border-top-width')).toBe(menu.borderWidth);
      expect(await picker('color')).toBe(menu.color);

      const options = zoom.locator('option');
      for (let i = 0; i < 3; i++) {
        expect((await options.nth(i).boundingBox())!.height).toBe(parseFloat(menu.itemHeight));
        expect(await css(options.nth(i), 'border-radius')).toBe(menu.itemRadius);
        expect(await css(options.nth(i), 'font-size')).toBe(menu.fontSize);
        expect(await css(options.nth(i), 'font-family')).toBe(menu.fontFamily);
        // Labels start where the menus' labels do, after the check column.
        const inset = await options.nth(i).evaluate((o) => {
          const text = [...o.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!;
          const r = document.createRange();
          r.selectNodeContents(text);
          return r.getBoundingClientRect().left - o.getBoundingClientRect().left;
        });
        expect(Math.abs(inset - menu.labelInset)).toBeLessThan(0.5);
      }
      // The keyboard highlight is the menus' highlight; the chosen item carries the check mark.
      const focused = zoom.locator('option:focus');
      await expect(focused).toHaveText('Fit Width');
      expect(await css(focused, 'background-color')).toBe(menu.highlight);
      expect(await css(focused, 'background-image')).toBe('none');
      expect(await css(focused, 'color')).toBe(menu.highlightText);
      expect(await css(options.nth(0), 'visibility', '::checkmark')).toBe('visible');
      expect(await css(options.nth(1), 'visibility', '::checkmark')).toBe('hidden');
      await page.keyboard.press('ArrowDown');
      await expect(focused).toHaveText('Fit Page');
      expect(await css(options.nth(0), 'background-color')).toBe('rgba(0, 0, 0, 0)');
      await page.keyboard.press('Escape');
      await expect.poll(() => zoom.evaluate((el) => el.matches(':open'))).toBe(false);
    });

    test('check boxes: off on the control fill, on in the accent with a white check, disabled faded', async ({ page }) => {
      await page.goto('/');
      await openSettings(page);
      const off = settings(page).getByLabel('Show the sidebar when a document opens');
      const on = settings(page).getByLabel("Remember each file's last page and zoom");
      const disabled = settings(page).getByLabel('Book Mode');
      await expect(off).not.toBeChecked();
      await expect(on).toBeChecked();
      await expect(disabled).toBeDisabled();
      for (const box of [off, on]) {
        const b = (await box.boundingBox())!;
        expect([b.width, b.height]).toEqual([14, 14]);
        expect(await css(box, 'border-radius')).toBe('3.5px');
        expect(await css(box, 'opacity')).toBe('1');
      }
      expect(await css(off, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--control-bg)'));
      expect(await css(off, 'background-image')).toBe('none');
      expect(await css(off, 'box-shadow')).toBe(await resolved(page, 'box-shadow', 'var(--control-shadow)'));
      expect(await css(on, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--accent)'));
      expect(await css(on, 'background-image')).toMatch(/^url\(.*(%23fff|white)/i);
      expect(Number(await css(disabled, 'opacity'))).toBeLessThan(1);
      // Clicking toggles the look along with the value.
      await off.click();
      expect(await css(off, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--accent)'));
      await off.click();
      // Keyboard focus shows the app's focus ring.
      await off.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(off).toBeFocused();
      expect(await css(off, 'box-shadow')).toContain(await resolved(page, 'box-shadow', 'var(--focus-ring)'));
    });

    test('colour swatches are circles like the markup palette', async ({ page }) => {
      await page.goto('/');
      await openSettings(page, 'Markup');
      const popup = settings(page).getByLabel('Highlight color');
      const swatches = popup.locator('.settings-swatch');
      expect(await swatches.count()).toBeGreaterThan(1);
      for (let i = 0; i < (await swatches.count()); i++) {
        expect(await css(swatches.nth(i), 'border-radius')).toBe('50%');
        expect(await css(swatches.nth(i), 'width')).toBe(await css(swatches.nth(i), 'height'));
      }
      // The one shown in the button, too.
      const shown = popup.locator('selectedcontent .settings-swatch');
      await expect(shown).toHaveCount(1);
      const s = (await shown.boundingBox())!;
      expect(s.width).toBe(s.height);
    });
  });
}

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
