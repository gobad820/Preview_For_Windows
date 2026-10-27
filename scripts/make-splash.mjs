// Renders scripts/splash/splash.html to src/assets/splash.jpg (2000 x 1400, the 1000 x 700
// layout at 2x). The version shown is package.json's major.minor; the name is scaled to fill its
// data-width once the font has loaded.
// Usage: node scripts/make-splash.mjs   (needs Playwright's Chromium)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const shown = version.split('.').slice(0, 2).join('.');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
await page.goto(`file://${root}scripts/splash/splash.html`);
await page.evaluate(async (shown) => {
  document.querySelector('.ver').textContent = shown;
  await document.fonts.ready;
  for (const el of document.querySelectorAll('[data-width]')) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${(size * Number(el.dataset.width)) / el.getBoundingClientRect().width}px`;
  }
}, shown);
await page.locator('.card').screenshot({ path: `${root}src/assets/splash.jpg`, type: 'jpeg', quality: 88 });
await browser.close();
console.log(`wrote src/assets/splash.jpg (version ${shown})`);
