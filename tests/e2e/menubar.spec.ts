import { expect, test, type Locator, type Page } from '@playwright/test';

async function open(page: Page, name: string) {
  await page.goto(`/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => (window as any).__pfw?.store.get().status === 'ready');
}

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__pfw?.store);
}

const state = (page: Page) => page.evaluate(() => (window as any).__pfw.store.get());
const bar = (page: Page) => page.locator('#menubar');
const title = (page: Page, name: string) => page.locator('#menubar').getByRole('menuitem', { name, exact: true });
const menu = (page: Page) => page.locator('.mb-menu');
const item = (page: Page, label: string): Locator => page.locator(`.mb-menu .mb-item:has(.mb-label:text-is("${label}"))`);
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const styles = (l: Locator, props: string[]): Promise<Record<string, string>> =>
  l.evaluate((el, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])), props);
/** What `value` (a theme token, usually) computes to for `prop`. */
const resolve = (page: Page, prop: string, value: string) =>
  page.evaluate(([p, v]) => {
    const probe = document.createElement('div');
    probe.style.setProperty(p!, v!);
    document.body.append(probe);
    const out = getComputedStyle(probe).getPropertyValue(p!);
    probe.remove();
    return out;
  }, [prop, value]);

/** A computed colour as [r, g, b, a], whether Chromium writes it rgb() or color(srgb …), as it does for color-mix(). */
function channels(c: string): number[] {
  const n = c.match(/[\d.]+/g)!.map(Number);
  const rgb = c.startsWith('color(srgb') ? n.slice(0, 3).map((v) => Math.round(v * 255)) : n.slice(0, 3);
  return [...rgb, n[3] ?? 1];
}

/** Class names of a menu's parts: the app's menus (src/ui/menu.ts) and the menu bar's drop-downs. */
const MENU = { item: '.menu-item', shortcut: '.menu-shortcut', separator: '.menu-separator', check: '.menu-check svg' };
const MB = { item: '.mb-item', shortcut: '.mb-shortcut', separator: '.mb-separator', check: '.mb-check svg' };

/** The computed look of an open menu that lists Zoom In (Ctrl+=), a disabled Book Mode and a checked Continuous Scroll. */
async function menuLook(m: Locator, parts: typeof MENU) {
  const row = (label: string) => m.locator(parts.item).filter({ hasText: label });
  const zoomIn = row('Zoom In');
  const look = {
    menu: await styles(m, [
      'background-color', 'backdrop-filter', 'box-shadow', 'color', 'font-family', 'font-size', 'line-height', 'letter-spacing',
      'padding-top', 'padding-left', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    ]),
    item: await styles(zoomIn, ['height', 'padding-left', 'padding-right', 'border-top-left-radius', 'color', 'background-color']),
    shortcut: await styles(zoomIn.locator(parts.shortcut), ['color', 'margin-left']),
    disabled: await styles(row('Book Mode'), ['color']),
    separator: await styles(m.locator(parts.separator).first(), ['height', 'margin-top', 'margin-left', 'margin-right', 'background-color']),
    check: await styles(row('Continuous Scroll').locator(parts.check), ['width', 'stroke-width']),
    highlight: {} as Record<string, string>,
    highlightShortcut: [] as number[],
  };
  await zoomIn.hover();
  look.highlight = await styles(zoomIn, ['background-color', 'color']);
  look.highlightShortcut = channels(await zoomIn.locator(parts.shortcut).evaluate((el) => getComputedStyle(el).color));
  return look;
}

/** The look of an app menu (src/ui/menu.ts) with the same kinds of rows as the menu bar's View menu. */
async function referenceMenuLook(page: Page) {
  await page.evaluate(() => {
    const none = () => {};
    void (window as any).__pfwUi.showMenu({ x: 400, y: 200 }, [
      { label: 'Zoom In', shortcut: 'Ctrl+=', action: none },
      { label: 'Book Mode', disabled: true, checked: false, action: none },
      'separator',
      { label: 'Continuous Scroll', checked: true, radio: true, action: none },
    ]);
  });
  const look = await menuLook(page.locator('.menu'), MENU);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);
  return look;
}

/** Opens `menuName` with a real click and clicks `label` in it. */
async function choose(page: Page, menuName: string, label: string) {
  await title(page, menuName).click();
  await item(page, label).click();
}

test.describe('menu bar look and place', () => {
  test('a 32px title bar in the toolbar\'s colours and type, one title area with it, semibold application menu', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, 'simple.pdf');
    await expect(bar(page)).toBeVisible();
    const b = (await bar(page).boundingBox())!;
    expect(b).toMatchObject({ x: 0, y: 0, height: 32, width: 1200 });
    expect((await page.locator('#toolbar').boundingBox())!.y).toBe(32);
    await expect(page.locator('#menubar .mb-title')).toHaveText(['Preview', 'File', 'Edit', 'View', 'Go', 'Tools', 'Window', 'Help']);
    expect(await css(title(page, 'Preview'), 'font-weight')).toBe('600');
    expect(await css(title(page, 'File'), 'font-weight')).toBe('400');
    expect(await css(title(page, 'File'), 'font-size')).toBe('13px');
    const font = await css(bar(page), 'font-family');
    expect(font).toBe(await css(page.locator('#toolbar .tb-doc-title'), 'font-family'));
    expect(font).toMatch(/^"?Inter"?,/);
    // Same background as the toolbar, no gradient, no line between them; the toolbar keeps its own hairline.
    expect(await css(bar(page), 'background-color')).toBe(await css(page.locator('#toolbar'), 'background-color'));
    expect(await css(bar(page), 'background-color')).toBe(await resolve(page, 'background-color', 'var(--chrome-bg)'));
    expect(await css(bar(page), 'background-image')).toBe('none');
    expect(await css(bar(page), 'box-shadow')).toBe('none');
    expect(await css(page.locator('#toolbar'), 'box-shadow')).not.toBe('none');
    expect(await css(bar(page), 'color')).toBe(await resolve(page, 'color', 'var(--text)'));
  });

  test('on Windows 11 Mica it turns translucent with the toolbar', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, 'simple.pdf');
    await page.evaluate(() => (document.documentElement.dataset['material'] = 'mica'));
    const bg = await css(bar(page), 'background-color');
    expect(bg).toBe(await css(page.locator('#toolbar'), 'background-color'));
    expect(bg).toMatch(/^rgba\(.*, 0\.\d+\)$/);
  });

  test('its empty part drags the window; the titles do not', async ({ page }) => {
    await open(page, 'simple.pdf');
    await expect(bar(page)).toHaveAttribute('data-tauri-drag-region', '');
    await expect(page.locator('#menubar .mb-flex')).toHaveAttribute('data-tauri-drag-region', '');
    expect(await page.locator('#menubar .mb-title[data-tauri-drag-region]').count()).toBe(0);
    // The empty part fills the bar after the last title.
    const flex = (await page.locator('#menubar .mb-flex').boundingBox())!;
    const help = (await title(page, 'Help').boundingBox())!;
    expect(flex.x).toBeGreaterThanOrEqual(help.x + help.width - 1);
    expect(flex.x + flex.width).toBeGreaterThan(1150);
  });

  test('follows the light and dark theme, bar and drop-downs alike', async ({ page }) => {
    await open(page, 'simple.pdf');
    const seen: string[] = [];
    for (const colorScheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await css(bar(page), 'background-color')).toBe(await css(page.locator('#toolbar'), 'background-color'));
      expect(await css(bar(page), 'color')).toBe(await resolve(page, 'color', 'var(--text)'));
      seen.push(await css(bar(page), 'background-color'));
      const reference = await referenceMenuLook(page);
      await title(page, 'View').click();
      expect(await menuLook(menu(page), MB)).toEqual(reference);
      await page.keyboard.press('Escape');
    }
    expect(seen[0]).not.toBe(seen[1]);
  });

  test('drop-downs look like the app\'s menus: rounded, blurred, blue highlight with white text', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, 'simple.pdf');
    const reference = await referenceMenuLook(page);
    const view = title(page, 'View');
    await view.click();
    await expect(view).toHaveAttribute('aria-expanded', 'true');
    const look = await menuLook(menu(page), MB);
    expect(look).toEqual(reference);
    // And what that look is, from the theme tokens.
    expect(look.menu['font-family']).toBe(await css(bar(page), 'font-family'));
    expect(look.menu['background-color']).toBe(await resolve(page, 'background-color', 'var(--menu-bg)'));
    expect(look.menu['backdrop-filter']).toMatch(/^blur\(/);
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      expect(look.menu[`border-${corner}-radius`]).toBe(await resolve(page, 'border-top-left-radius', 'var(--radius-menu)'));
    }
    expect(look.item['height']).toBe('22px');
    expect(look.highlight['background-color']).toBe(await resolve(page, 'background-color', 'var(--accent-strong)'));
    expect(look.highlight['color']).toBe(await resolve(page, 'color', 'var(--accent-fg)'));
    expect(look.shortcut['color']).toBe(await resolve(page, 'color', 'var(--text-secondary)'));
    expect(look.disabled['color']).toBe(await resolve(page, 'color', 'var(--text-tertiary)'));
    expect(look.separator['background-color']).toBe(await resolve(page, 'background-color', 'var(--hairline)'));

    // The open title: a rounded --fill-pressed rect, text colour unchanged, no blue.
    expect(await css(view, 'background-color')).toBe(await resolve(page, 'background-color', 'var(--fill-pressed)'));
    expect(await css(view, 'background-image')).toBe('none');
    expect(await css(view, 'color')).toBe(await css(bar(page), 'color'));
    expect(await css(view, 'border-top-left-radius')).toBe('5px');
    // Just under the bar, left edge under the title.
    const t = (await view.boundingBox())!;
    const m = (await menu(page).boundingBox())!;
    expect(Math.round(m.y)).toBe(34);
    expect(Math.abs(m.x - t.x)).toBeLessThanOrEqual(1);

    // Shortcuts are right-aligned.
    const zoomIn = item(page, 'Zoom In');
    const key = zoomIn.locator('.mb-shortcut');
    await expect(key).toHaveText('Ctrl+=');
    const k = (await key.boundingBox())!;
    const zoomOutKey = (await item(page, 'Zoom Out').locator('.mb-shortcut').boundingBox())!;
    expect(Math.abs(k.x + k.width - (zoomOutKey.x + zoomOutKey.width))).toBeLessThanOrEqual(1);
    // Separators and check marks.
    expect(await menu(page).locator('.mb-separator').count()).toBeGreaterThan(0);
    await expect(item(page, 'Continuous Scroll')).toHaveAttribute('aria-checked', 'true');
    await expect(item(page, 'Continuous Scroll').locator('.mb-check svg')).toBeVisible();
    await expect(item(page, 'Two Pages')).toHaveAttribute('aria-checked', 'false');
    await expect(item(page, 'Two Pages').locator('.mb-check svg')).toHaveCount(0);

    // A title the keyboard is on looks the same as an open one.
    await page.keyboard.press('Escape');
    await page.keyboard.press('F10');
    await expect(title(page, 'Preview')).toHaveClass(/\bfocused\b/);
    expect(await css(title(page, 'Preview'), 'background-color')).toBe(await resolve(page, 'background-color', 'var(--fill-pressed)'));
    expect(await css(title(page, 'Preview'), 'color')).toBe(await css(bar(page), 'color'));
  });
});

test.describe('menus and commands', () => {
  test('every item names a registered command', async ({ page }) => {
    await open(page, 'simple.pdf');
    const missing = await page.evaluate(() => {
      const { app, menuBar } = (window as any).__pfw;
      return menuBar.menus.flatMap((m: any) => m.items).filter((id: string) => id !== '-' && !app.commands.get(id));
    });
    expect(missing).toEqual([]);
  });

  test('each menu opens with the mouse and lists its commands', async ({ page }) => {
    await open(page, 'simple.pdf');
    const expected: Record<string, string[]> = {
      Preview: ['About Preview', 'Settings…', 'Close Window'],
      File: ['Open…', 'Close Window', 'Save', 'Save As…', 'Print…'],
      Edit: ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Duplicate', 'Select All Pages', 'Insert Pages from File…', 'Find…'],
      View: [
        'Show Sidebar', 'Thumbnails', 'Table of Contents', 'Continuous Scroll', 'Two Pages', 'Book Mode',
        'Actual Size', 'Fit Width', 'Fit Page', 'Zoom In', 'Zoom Out', 'Show Markup Toolbar', 'Menu Bar',
      ],
      Go: ['Previous Page', 'Next Page', 'First Page', 'Last Page', 'Go to Page…'],
      Tools: [
        'Rotate Left', 'Rotate Right', 'Text Selection', 'Highlight', 'Underline', 'Strikethrough',
        'Draw', 'Line', 'Arrow', 'Rectangle', 'Rounded Rectangle', 'Oval', 'Text', 'Note',
      ],
      Window: ['Minimize', 'Zoom'],
      Help: ['Keyboard Shortcuts', 'About Preview'],
    };
    for (const [name, labels] of Object.entries(expected)) {
      await title(page, name).click();
      await expect(menu(page)).toHaveCount(1);
      await expect(menu(page)).toHaveAttribute('aria-label', name);
      await expect(menu(page).locator('.mb-label')).toHaveText(labels);
      await page.keyboard.press('Escape');
      await expect(menu(page)).toHaveCount(0);
    }
  });

  test('moving over other titles switches menus; clicking the title or elsewhere closes', async ({ page }) => {
    await open(page, 'simple.pdf');
    await title(page, 'File').click();
    await expect(menu(page)).toHaveAttribute('aria-label', 'File');
    await title(page, 'Go').hover();
    await expect(menu(page)).toHaveAttribute('aria-label', 'Go');
    await expect(title(page, 'File')).toHaveAttribute('aria-expanded', 'false');
    await expect(title(page, 'Go')).toHaveAttribute('aria-expanded', 'true');
    await title(page, 'Go').click();
    await expect(menu(page)).toHaveCount(0);
    // Without an open menu, hovering does nothing.
    await title(page, 'Edit').hover();
    await expect(menu(page)).toHaveCount(0);

    // A click elsewhere closes the menu and goes no further.
    await page.evaluate(() => (window as any).__pfw.app.commands.run('tools.rect'));
    await title(page, 'Edit').click();
    const before = await page.evaluate(() => (window as any).__pfw.app.document.pages.length);
    const pageBox = (await page.locator('#viewer .page[data-page="1"]').boundingBox())!;
    await page.mouse.move(pageBox.x + 60, pageBox.y + 60);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 160, pageBox.y + 160, { steps: 4 });
    await page.mouse.up();
    await expect(menu(page)).toHaveCount(0);
    const annots = await page.evaluate(() => (window as any).__pfw.app.document.annotationsAt(0)?.length ?? 0);
    expect(annots).toBe(0);
    expect(await page.evaluate(() => (window as any).__pfw.app.document.pages.length)).toBe(before);
  });

  test('a closing press that is cancelled (touch pan) does not swallow the next click', async ({ page }) => {
    await open(page, 'simple.pdf');
    await title(page, 'File').click();
    await page.evaluate(() => {
      const viewer = document.getElementById('viewer')!;
      const init = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, clientX: 400, clientY: 400 };
      viewer.dispatchEvent(new PointerEvent('pointerdown', init));
      viewer.dispatchEvent(new PointerEvent('pointercancel', init));
    });
    await expect(menu(page)).toHaveCount(0);
    await page.locator('#toolbar [data-action="sidebar"]').click();
    expect((await state(page)).sidebarOpen).toBe(true);
  });

  test('press on a title, drag to an item and release runs it', async ({ page }) => {
    await open(page, 'simple.pdf');
    const go = (await title(page, 'Go').boundingBox())!;
    await page.mouse.move(go.x + go.width / 2, go.y + go.height / 2);
    await page.mouse.down();
    const last = (await item(page, 'Last Page').boundingBox())!;
    await page.mouse.move(last.x + 20, last.y + last.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(menu(page)).toHaveCount(0);
    const s = await state(page);
    expect(s.currentPage).toBe(s.numPages);
  });

  test('runs a command from each menu with the mouse', async ({ page }) => {
    await page.addInitScript(() => ((window as any).__pfwNextOpenPaths = ['fixtures/simple.pdf']));
    await boot(page);
    // File › Open… from the empty window.
    await choose(page, 'File', 'Open…');
    await page.waitForFunction(() => (window as any).__pfw.store.get().status === 'ready');
    // Preview › About Preview
    await choose(page, 'Preview', 'About Preview');
    await expect(page.locator('.about')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.about')).toHaveCount(0);
    // Edit › Select All Pages
    await choose(page, 'Edit', 'Select All Pages');
    expect(await page.evaluate(() => (window as any).__pfw.editor.selection.size)).toBe((await state(page)).numPages);
    // View › Two Pages
    await choose(page, 'View', 'Two Pages');
    expect((await state(page)).displayMode).toBe('two-pages');
    // Go › Last Page
    await choose(page, 'Go', 'Last Page');
    await expect.poll(async () => (await state(page)).currentPage).toBe((await state(page)).numPages);
    // Tools › Rectangle
    await choose(page, 'Tools', 'Rectangle');
    expect(await page.evaluate(() => (window as any).__pfw.app.markup.tool)).toBe('rect');
    expect((await state(page)).markupOpen).toBe(true);
    // Window: the browser host has no window controls.
    await title(page, 'Window').click();
    await expect(item(page, 'Minimize')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    // Help › Keyboard Shortcuts
    await choose(page, 'Help', 'Keyboard Shortcuts');
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
  });

  test('labels and check marks follow state each time a menu opens', async ({ page }) => {
    await open(page, 'simple.pdf');
    await choose(page, 'View', 'Show Sidebar');
    expect((await state(page)).sidebarOpen).toBe(true);
    await title(page, 'View').click();
    await expect(item(page, 'Hide Sidebar')).toBeVisible();
    await expect(item(page, 'Thumbnails')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
  });

  test('without a document only what can work is enabled; disabled items are grey and do nothing', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);
    await title(page, 'File').click();
    await expect(item(page, 'Open…')).not.toHaveAttribute('aria-disabled', 'true');
    for (const label of ['Save', 'Save As…', 'Print…']) await expect(item(page, label)).toHaveAttribute('aria-disabled', 'true');
    expect(await css(item(page, 'Save'), 'color')).toBe(await resolve(page, 'color', 'var(--text-tertiary)'));
    await item(page, 'Save').hover();
    expect(await css(item(page, 'Save'), 'background-color')).toBe('rgba(0, 0, 0, 0)');
    // A real click on the greyed-out row (Playwright skips aria-disabled elements unless forced).
    await item(page, 'Save').click({ force: true });
    await expect(menu(page)).toHaveCount(1);
    for (const name of ['Edit', 'Go', 'Tools']) {
      await title(page, name).hover();
      const states = await menu(page).locator('.mb-item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-disabled')));
      expect(states.every((s) => s === 'true'), name).toBe(true);
    }
    await page.keyboard.press('Escape');
  });
});

test.describe('keyboard', () => {
  test('Alt alone focuses the bar; arrows move, Down opens, Enter runs', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Alt');
    await expect(bar(page)).toHaveClass(/\bkeys\b/);
    await expect(title(page, 'Preview')).toHaveClass(/\bfocused\b/);
    expect(await css(title(page, 'File').locator('.mb-key'), 'text-decoration-line')).toBe('underline');
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(title(page, 'View')).toHaveClass(/\bfocused\b/);
    await expect(title(page, 'Preview')).not.toHaveClass(/\bfocused\b/);
    await page.keyboard.press('ArrowDown');
    await expect(menu(page)).toHaveAttribute('aria-label', 'View');
    await expect(item(page, 'Show Sidebar')).toHaveClass(/\bactive\b/);
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'Thumbnails')).toHaveClass(/\bactive\b/);
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    expect((await state(page)).sidebarOpen).toBe(true);
    await expect(bar(page)).not.toHaveClass(/\bkeys\b/);
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
  });

  test('Alt+letter opens that menu; arrows wrap and switch menus; Esc steps back, then leaves', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Alt+g');
    await expect(menu(page)).toHaveAttribute('aria-label', 'Go');
    await expect(item(page, 'Previous Page')).toHaveClass(/\bactive\b/);
    // Home and End jump; one row is highlighted at a time.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await expect(item(page, 'Go to Page…')).toHaveClass(/\bactive\b/);
    await expect(menu(page).locator('.mb-item.active')).toHaveCount(1);
    await page.keyboard.press('Home');
    await expect(item(page, 'Previous Page')).toHaveClass(/\bactive\b/);
    await expect(menu(page).locator('.mb-item.active')).toHaveCount(1);
    await page.keyboard.press('ArrowUp');
    await expect(item(page, 'Go to Page…')).toHaveClass(/\bactive\b/);
    await page.keyboard.press('ArrowUp');
    await expect(item(page, 'Last Page')).toHaveClass(/\bactive\b/);
    await page.keyboard.press('ArrowLeft');
    await expect(menu(page)).toHaveAttribute('aria-label', 'View');
    // Type-select by label, by the physical key when the Korean IME reports a Hangul letter, never with Ctrl.
    await page.keyboard.press('z');
    await expect(item(page, 'Zoom In')).toHaveClass(/\bactive\b/);
    await page.keyboard.press('Control+a');
    await expect(item(page, 'Zoom In')).toHaveClass(/\bactive\b/);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅋ', code: 'KeyZ', bubbles: true, cancelable: true })));
    await expect(item(page, 'Zoom Out')).toHaveClass(/\bactive\b/);
    await page.keyboard.press('ArrowRight');
    await expect(menu(page)).toHaveAttribute('aria-label', 'Go');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(title(page, 'Go')).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
    await expect(bar(page)).not.toHaveClass(/\bkeys\b/);

    // Alt again leaves, too.
    await page.keyboard.press('Alt');
    await expect(title(page, 'Preview')).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('Alt');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
  });

  test('F10 focuses the bar too', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('F10');
    await expect(title(page, 'Preview')).toHaveClass(/\bfocused\b/);
    // Ctrl shortcuts are not access keys.
    await page.keyboard.press('Control+f');
    await expect(menu(page)).toHaveCount(0);
    await expect(title(page, 'Preview')).toHaveClass(/\bfocused\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
  });

  test('Ctrl+Alt+S, Alt+Shift, a mouse press and the 한/영 key leave the bar alone', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Control+Alt+s');
    expect((await state(page)).sidebarOpen).toBe(true);
    await page.keyboard.down('Alt');
    await page.keyboard.press('Shift');
    await page.keyboard.up('Alt');
    await page.keyboard.down('Alt');
    const v = (await page.locator('#viewer').boundingBox())!;
    await page.mouse.click(v.x + 10, v.y + v.height - 10);
    await page.keyboard.up('Alt');
    // Alt+wheel, and Alt pressed and released while a mouse button is held.
    await page.mouse.move(v.x + 200, v.y + 200);
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Alt');
    await page.mouse.down();
    await page.keyboard.press('Alt');
    await page.mouse.up();
    await page.evaluate(() => {
      for (const type of ['keydown', 'keyup']) {
        window.dispatchEvent(new KeyboardEvent(type, { key: 'HangulMode', code: 'Lang1', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent(type, { key: 'Alt', code: 'AltRight', altKey: type === 'keydown', bubbles: true }));
      }
    });
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
    await expect(menu(page)).toHaveCount(0);
  });

  test('while a menu is open, Esc, arrows and Enter belong to it', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.keyboard.press('Control+f');
    await page.keyboard.type('the');
    await expect.poll(async () => (await state(page)).findTotal).toBeGreaterThan(1);
    const before = await state(page);
    await title(page, 'View').click();
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowUp']) await page.keyboard.press(key);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    let s = await state(page);
    expect(s.findOpen).toBe(true);
    expect(s.findIndex).toBe(before.findIndex);
    expect(s.currentPage).toBe(before.currentPage);
    // Enter with nothing highlighted closes the menu without searching again.
    await title(page, 'View').click();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    s = await state(page);
    expect(s.findIndex).toBe(before.findIndex);
    await expect(page.locator('#findbar input[data-find-input]')).toBeFocused();
  });
});

test.describe('selections survive the menus', () => {
  test('Edit › Copy copies the text selected before the menu opened', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.waitForSelector('#viewer .page[data-page="1"] .textLayer span');
    const selected = await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll('#viewer .page[data-page="1"] .textLayer span')).find((s) => (s.textContent ?? '').trim().length > 3)!;
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.addEventListener('copy', () => ((window as any).__copied = String(window.getSelection())));
      return String(sel);
    });
    expect(selected.trim().length).toBeGreaterThan(3);
    await title(page, 'Edit').click();
    await title(page, 'View').hover();
    await title(page, 'Edit').hover();
    expect(await page.evaluate(() => String(window.getSelection()))).toBe(selected);
    await item(page, 'Copy').click();
    expect(await page.evaluate(() => (window as any).__copied)).toBe(selected);
    expect(await page.evaluate(() => String(window.getSelection()))).toBe(selected);
  });

  test('page selection and focus in the sidebar survive; Edit › Copy copies the pages', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.store.set({ sidebarOpen: true }));
    await page.locator('#sidebar .thumb[data-page="1"]').click();
    await page.locator('#sidebar .thumb[data-page="2"]').click({ modifiers: ['Shift'] });
    expect(await page.evaluate(() => (window as any).__pfw.editor.selection.size)).toBe(2);
    const focused = await page.evaluate(() => document.activeElement?.closest('#sidebar') !== null);
    expect(focused).toBe(true);
    await page.keyboard.press('Alt+e');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await title(page, 'Edit').click();
    expect(await page.evaluate(() => document.activeElement?.closest('#sidebar') !== null)).toBe(true);
    await item(page, 'Copy').click();
    expect(await page.evaluate(() => (window as any).__pfw.editor.selection.size)).toBe(2);
    await expect.poll(() => page.evaluate(() => (window as any).__pfwFiles.has('clipboard-1.pdf'))).toBe(true);
  });

  test('a selected annotation stays selected and is not nudged by menu keys', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.waitForSelector('#viewer .page[data-page="1"] canvas[data-rendered="true"]');
    await page.evaluate(() => {
      const { app } = (window as any).__pfw;
      app.document.setAnnotations(0, [
        { id: 'r1', kind: 'rect', color: '#ff0000', opacity: 1, modified: '', rect: { x0: 100, y0: 100, x1: 200, y1: 200 }, fill: null, width: 2, rounded: false },
      ]);
      app.markupController.select({ pageId: app.document.pages[0].id, annotId: 'r1' });
    });
    const rect = () => page.evaluate(() => (window as any).__pfw.app.document.annotationsAt(0).map((a: any) => a.rect));
    const before = await rect();
    await title(page, 'Edit').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__pfw.app.markupController.selected?.annotId)).toBe('r1');
    expect(await rect()).toEqual(before);
    await choose(page, 'Edit', 'Duplicate');
    await expect.poll(() => page.evaluate(() => (window as any).__pfw.app.document.annotationsAt(0).length)).toBe(2);
  });
});

test.describe('hidden menu bar', () => {
  test('View › Menu Bar hides it; Alt shows it while navigating', async ({ page }) => {
    await open(page, 'simple.pdf');
    await title(page, 'View').click();
    await expect(item(page, 'Menu Bar')).toHaveAttribute('aria-checked', 'true');
    await item(page, 'Menu Bar').click();
    await expect(bar(page)).toBeHidden();
    expect((await state(page)).menuBarVisible).toBe(false);
    expect((await page.locator('#toolbar').boundingBox())!.y).toBe(0);

    await page.keyboard.press('Alt');
    await expect(bar(page)).toBeVisible();
    await expect(title(page, 'Preview')).toHaveClass(/\bfocused\b/);
    // It shows over the toolbar: nothing below moves or resizes.
    expect((await bar(page).boundingBox())!.y).toBe(0);
    expect((await page.locator('#toolbar').boundingBox())!.y).toBe(0);
    // With the same look as when it shows.
    expect(await css(bar(page), 'background-color')).toBe(await css(page.locator('#toolbar'), 'background-color'));
    // It takes the toolbar's whole height, so no toolbar control shows half covered under it.
    expect(await css(bar(page), 'height')).toBe('52px');
    await page.keyboard.press('ArrowDown');
    expect(Math.round((await menu(page).boundingBox())!.y)).toBe(54);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(bar(page)).toBeHidden();

    await page.keyboard.press('Alt+v');
    await expect(bar(page)).toBeVisible();
    await expect(item(page, 'Menu Bar')).toHaveAttribute('aria-checked', 'false');
    await item(page, 'Menu Bar').click();
    await expect(bar(page)).toBeVisible();
    expect((await state(page)).menuBarVisible).toBe(true);
  });

  test('the error toast sits under the toolbar whether or not the bar shows', async ({ page }) => {
    await open(page, 'simple.pdf');
    await page.evaluate(() => (window as any).__pfw.store.set({ error: 'Something went wrong' }));
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const toolbarBottom = 32 + 52;
    expect(Math.round((await page.locator('.error-banner').boundingBox())!.y)).toBe(toolbarBottom + 12);
    await page.evaluate(() => (window as any).__pfw.store.set({ menuBarVisible: false }));
    expect(Math.round((await page.locator('.error-banner').boundingBox())!.y)).toBe(52 + 12);
  });
});

/** The computed look of the app's alert (src/ui/dialog.ts) and its scrim. */
async function alertLook(page: Page) {
  await page.evaluate(() => {
    void (window as any).__pfwUi.showAlert({ title: 'Probe', buttons: [{ label: 'OK', value: 'ok', primary: true, cancel: true }] });
  });
  const look = {
    panel: await styles(page.locator('.alert'), PANEL),
    scrim: await styles(page.locator('.alert-scrim'), ['background-color']),
  };
  await page.keyboard.press('Escape');
  await expect(page.locator('.alert')).toHaveCount(0);
  return look;
}
const PANEL = [
  'background-color', 'backdrop-filter', 'box-shadow', 'color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
];
const KEYCAP = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border-top-left-radius', 'box-shadow'];

test.describe('Help › Keyboard Shortcuts', () => {
  test('a panel like the alerts lists the shortcuts by menu; Esc or the close button closes it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, 'simple.pdf');
    await page.locator('#viewer').focus();
    await choose(page, 'Help', 'Keyboard Shortcuts');
    const panel = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('h3')).toHaveText(['Preview', 'File', 'Edit', 'View', 'Go', 'Tools']);
    const row = panel.locator('.ks-row:has(.ks-label:text-is("Open…"))');
    await expect(row.locator(':scope > kbd')).toHaveText('Ctrl+O');
    await expect(row.locator('kbd kbd')).toHaveText(['Ctrl', 'O']);
    await expect(panel.locator('.ks-row:has(.ks-label:text-is("Close Window"))')).toHaveCount(1);
    await expect(panel.locator('.ks-section:has(h3:text-is("File")) .ks-label:text-is("Close Window")')).toHaveCount(1);
    // Modal: keys do not reach the document, and the menu bar stays put.
    await page.keyboard.press('End');
    expect((await state(page)).currentPage).toBe(1);
    await page.keyboard.press('Alt');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
    // Browser keys (reload, print) do nothing behind it.
    const notPrevented = await page.evaluate(() =>
      [{ key: 'F5' }, { key: 'r', ctrlKey: true }, { key: 'p', ctrlKey: true }].map((k) =>
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true, cancelable: true })),
      ),
    );
    expect(notPrevented).toEqual([false, false, false]);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.locator('#viewer')).toBeFocused();

    await choose(page, 'Help', 'Keyboard Shortcuts');
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('the panel has the alerts\' look and the empty window\'s key caps, in light and dark', async ({ page }) => {
    await open(page, 'simple.pdf');
    const panel = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    const seen: string[] = [];
    for (const colorScheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme });
      const reference = await alertLook(page);
      await choose(page, 'Help', 'Keyboard Shortcuts');
      await expect(panel).toBeVisible();
      expect(await styles(panel, PANEL)).toEqual(reference.panel);
      expect(await styles(panel.locator('xpath=..'), ['background-color'])).toEqual(reference.scrim);
      expect(await css(panel, 'background-color')).toBe(await resolve(page, 'background-color', 'var(--alert-bg)'));
      expect(await css(panel, 'font-family')).toBe(await css(bar(page), 'font-family'));
      seen.push(await css(panel, 'background-color'));
      // Section headers in the secondary text colour; labels in the text colour.
      expect(await css(panel.locator('h3').first(), 'color')).toBe(await resolve(page, 'color', 'var(--text-secondary)'));
      expect(await css(panel.locator('.ks-label').first(), 'color')).toBe(await resolve(page, 'color', 'var(--text)'));
      // Key caps like the empty window's hint.
      const cap = panel.locator('.ks-row kbd kbd').first();
      expect(await styles(cap, KEYCAP)).toEqual(await styles(page.locator('.empty-state kbd').first(), KEYCAP));
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
    }
    expect(seen[0]).not.toBe(seen[1]);
  });
});
