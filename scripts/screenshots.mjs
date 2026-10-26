// Visual review captures for the Mac-style chrome, light and dark.
//
// Needs a running dev or preview server:
//   npx vite --port 4188 --strictPort &      (or: npm run build && npx vite preview --port 4188)
//   node scripts/screenshots.mjs [scene ...]
// Env: PW_PORT (default 4188), OUT (default docs/screenshots), SCALE (deviceScaleFactor, default 2).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = `http://localhost:${process.env.PW_PORT ?? 4188}`;
const out = process.env.OUT ?? 'docs/screenshots';
const scale = Number(process.env.SCALE ?? 2);
mkdirSync(out, { recursive: true });

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__pfw?.store.get();
    return s && (s.status === 'ready' || s.status === 'error' || s.status === 'empty');
  });

async function openFile(page, name) {
  await page.goto(`${base}/?file=${encodeURIComponent(`fixtures/${name}`)}`);
  await page.waitForFunction(() => window.__pfw?.store.get().status === 'ready');
  await page.waitForSelector('.page[data-page="1"] canvas[data-rendered="true"]');
}

/** Waits for fonts, page canvases and any running CSS animation. */
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
  });
  await page.waitForTimeout(250);
}

async function thumbsRendered(page, pages) {
  for (const n of pages) await page.waitForSelector(`#sidebar .thumb[data-page="${n}"] canvas[data-rendered="true"]`);
}

const scenes = {
  async empty(page) {
    await page.goto(base);
    await ready(page);
  },

  async document(page) {
    await openFile(page, 'outline.pdf');
    await page.evaluate(() => window.__pfw.store.set({ sidebarOpen: true }));
    await thumbsRendered(page, [1, 2, 3]);
  },

  async edited(page) {
    await openFile(page, '한글 문서.pdf');
    await page.evaluate(() => window.__pfw.store.set({ dirty: true }));
  },

  /** Static demo of the classes the page-editing branch toggles. */
  async selection(page) {
    await openFile(page, 'long300.pdf');
    await page.evaluate(() => window.__pfw.store.set({ sidebarOpen: true }));
    await thumbsRendered(page, [1, 2, 3, 4]);
    await page.evaluate(() => {
      const list = document.querySelector('#sidebar .sidebar-panel.thumbnails');
      const thumb = (n) => list.querySelector(`.thumb[data-page="${n}"]`);
      thumb(2).classList.add('selected');
      thumb(3).classList.add('selected', 'dragging');
      // Insertion line in the gap between pages 1 and 2.
      const indicator = document.createElement('div');
      indicator.className = 'drop-indicator visible';
      const a = thumb(1).getBoundingClientRect();
      const b = thumb(2).getBoundingClientRect();
      const top = (a.bottom + b.top) / 2 - list.getBoundingClientRect().top + list.scrollTop;
      indicator.style.top = `${top}px`;
      list.append(indicator);
      // Ghost stack following the pointer, built from rendered thumbnail canvases.
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      for (const n of [2, 3]) {
        const src = thumb(n).querySelector('canvas');
        const img = document.createElement('img');
        img.src = src.toDataURL();
        img.style.width = `${src.clientWidth * 0.5}px`;
        ghost.append(img);
      }
      const count = document.createElement('span');
      count.className = 'drag-count';
      count.textContent = '2';
      ghost.append(count);
      ghost.style.left = '120px';
      ghost.style.top = '240px';
      document.body.append(ghost);
      thumb(2).focus();
    });
  },

  async 'selection-unfocused'(page) {
    await scenes.selection(page);
    await page.evaluate(() => {
      document.querySelector('.drag-ghost')?.remove();
      document.querySelector('.drop-indicator')?.remove();
      document.querySelector('#sidebar .thumb[data-page="3"]').classList.remove('dragging');
      document.querySelector('#viewer').focus();
    });
  },

  async 'zoom-menu'(page) {
    await openFile(page, 'simple.pdf');
    await page.click('[data-zoom-menu]');
  },

  async 'more-menu'(page) {
    await openFile(page, 'simple.pdf');
    await page.click('[data-action="more"]');
  },

  async 'context-menu'(page) {
    await openFile(page, 'simple.pdf');
    await page.evaluate(() => {
      void window.__pfwUi.showMenu({ x: 420, y: 220 }, [
        { label: 'Cut', shortcut: 'Ctrl+X', action() {} },
        { label: 'Copy', shortcut: 'Ctrl+C', action() {} },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: true, action() {} },
        { label: 'Delete', shortcut: 'Del', action() {} },
        'separator',
        { label: 'Select All', shortcut: 'Ctrl+A', action() {} },
        'separator',
        { label: 'Insert Pages from File…', action() {} },
      ]);
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
  },

  async find(page) {
    await openFile(page, 'outline.pdf');
    await page.evaluate(() => window.__pfw.findBar.open());
    await page.keyboard.type('Section');
    await page.waitForFunction(() => window.__pfw.store.get().findTotal > 0);
  },

  async alert(page) {
    await openFile(page, 'simple.pdf');
    await page.evaluate(() => {
      void window.__pfwUi.showAlert({
        title: 'Do you want to save the changes made to the document “simple.pdf”?',
        message: 'Your changes will be lost if you don’t save them.',
        buttons: [
          { label: 'Save', value: 'save', primary: true },
          { label: 'Don’t Save', value: 'discard' },
          { label: 'Cancel', value: 'cancel', cancel: true },
        ],
      });
    });
  },

  async 'password-alert'(page) {
    await page.goto(base);
    await ready(page);
    await page.evaluate(() => {
      void window.__pfwUi.showAlert({
        title: '“contract.pdf” is password protected.',
        message: 'Enter the password to insert its pages.',
        input: { type: 'password', placeholder: 'Password' },
        buttons: [
          { label: 'Insert', value: 'ok', primary: true },
          { label: 'Cancel', value: 'cancel', cancel: true },
        ],
      });
    });
    await page.keyboard.type('secret');
  },

  async 'password-panel'(page) {
    await page.goto(`${base}/?file=fixtures/encrypted.pdf`);
    await page.waitForSelector('.password-panel:not([hidden])');
  },

  async error(page) {
    await openFile(page, 'simple.pdf');
    await page.evaluate(() => window.__pfw.app.openPath('fixtures/broken.pdf'));
    await page.waitForSelector('.error-banner:not([hidden])');
  },

  async loading(page) {
    await page.goto(base);
    await ready(page);
    await page.evaluate(() => window.__pfw.store.set({ status: 'loading' }));
  },

  async 'drop-overlay'(page) {
    await page.goto(base);
    await ready(page);
    await page.evaluate(() => (document.querySelector('.drop-overlay').hidden = false));
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(scenes);
// Subpixel glyph positioning, closer to DirectWrite in WebView2 than Linux's hinted default.
const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 720 },
    deviceScaleFactor: scale,
    colorScheme: theme,
  });
  for (const name of names) {
    const scene = scenes[name];
    if (!scene) throw new Error(`unknown scene ${name}`);
    const page = await context.newPage();
    await scene(page);
    await settle(page);
    const file = join(out, `${name}-${theme}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
  await context.close();
}
await browser.close();
