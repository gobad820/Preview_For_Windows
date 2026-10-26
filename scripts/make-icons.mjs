// Regenerates src-tauri/icons from the pixel-art sources in src-tauri/icons/source.
// 16 px has its own drawing; 24, 32 and 48 px are the 32 px drawing rasterized at that size;
// 64–512 px are the 32 px raster enlarged without smoothing, for the classic pixel look.
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium and python with Pillow)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src-tauri/icons/source');
const out = join(root, 'src-tauri/icons');
const tmp = mkdtempSync(join(tmpdir(), 'pfw-icons-'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size] of [['icon-16.svg', 16], ['icon-32.svg', 24], ['icon-32.svg', 32], ['icon-32.svg', 48]]) {
  const svg = readFileSync(join(src, file), 'utf8').replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: join(tmp, `${size}.png`), omitBackground: true });
}
await browser.close();
execFileSync(process.env.PYTHON ?? 'python3', [join(root, 'scripts/make-icons.py'), tmp, out], { stdio: 'inherit' });
