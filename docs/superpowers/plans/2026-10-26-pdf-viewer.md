# Preview for Windows — PDF Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fast, clean, Preview-like PDF viewer shipped as a Windows exe, built and tested from WSL.

**Architecture:** Tauri v2 shell (thin Rust: file read, dialog, startup argument, drag-drop, window state) hosting a Vite + TypeScript frontend that renders with pdf.js into a virtualised, continuously scrolling page list. All viewer logic that can be pure (layout, zoom, search matching, shortcuts, persistence) lives in framework-free modules with Vitest tests; the DOM components are exercised with Playwright against a browser platform shim; the real exe is smoke-launched on the Windows host.

**Tech Stack:** Tauri 2 (Rust stable 1.99, cargo-xwin → x86_64-pc-windows-msvc), Vite 6, TypeScript 5, pdfjs-dist 4/5 (`TextLayer` API), Vitest, Playwright (Chromium), NSIS via conda-forge makensis.

**Spec:** `docs/superpowers/specs/2026-10-26-pdf-viewer-design.md`

## Global Constraints

- Tauri `2.x` stable only (never the 3.0 alphas). npm `@tauri-apps/cli@^2`, `@tauri-apps/api@^2`.
- App identifier `dev.sanghae.preview`; product name `Preview`; window title is the bare file name, or `Preview` with no file.
- No network access at runtime; no telemetry.
- First visible page painted before the remaining page sizes are fetched; target < 1000 ms to first paint on the 300-page fixture in headless Chromium.
- Light and dark theme from `prefers-color-scheme`; all colors are CSS custom properties on `:root`.
- Zoom range 10%–800%; `scale` 1.0 means 100%, where displayed CSS width = PDF points × scale × 96/72.
- Shortcuts (Windows): Ctrl+O open, Ctrl+F find, Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out, Ctrl+0 100%, Ctrl+1 fit width, Ctrl+2 fit page, Ctrl+L rotate clockwise, Ctrl+Shift+L rotate counter-clockwise, Ctrl+Shift+S toggle sidebar, Ctrl+G go to page, Space / Shift+Space scroll a viewport, PageDown/PageUp, Home/End first/last page, Right/Left arrow next/previous page (when not fit-width-scrolling horizontally), Esc close find bar, Enter / Shift+Enter next/previous match while the find field is focused.
- Build from WSL with: `source ~/.cargo/env; export PATH=/home/ssafy/miniforge3/envs/winbuild/bin:$PATH; XWIN_ARCH=x86_64`.
- Commit after every task with a conventional-commit message.

## Review Focus

1. Encrypted or corrupted PDF: the viewer shows an inline error ("Can't open <name>" plus the reason) and stays usable; it never leaves a spinner or blank window. Test in Task 9.
2. 300-page document: the DOM holds at most ~10 mounted `.page` canvases at any scroll position, and the first page paints before all page sizes are known. Test in Task 9.
3. Mixed page sizes (A4 portrait, A4 landscape, a small 200×200 pt page): every page is horizontally centered and fit-width is computed from the widest rotated page. Tests in Task 3 and Task 9.
4. Non-ASCII path (Korean file name): the file opens and the window title shows the name. Test in Task 10 (browser, encoded URL) and Task 14 (Windows smoke launch).
5. Zoom anchoring: after Ctrl+= at page 150 of 300 the current page is still 150; Ctrl+wheel keeps the document point under the cursor fixed. Tests in Task 3 (pure) and Task 9 (e2e).
6. HiDPI: at `deviceScaleFactor: 2` each page canvas backing store is 2× its CSS size. Test in Task 9.

---

## File Structure

```
package.json, vite.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
index.html                       — single page shell: toolbar, sidebar, main, find bar mount points
src/main.ts                      — picks platform (tauri vs browser) and starts App
src/app.ts                       — App: wires store, platform, components; open-file flow
src/types.ts                     — shared primitives: Rotation, ZoomMode, PageSize (dependency-free)
src/store.ts                     — createStore<T>(): reactive state container
src/platform/types.ts            — Platform interface + FileState type
src/platform/browser.ts          — browser shim for e2e (fetch ?file=, HTML5 drop)
src/platform/tauri.ts            — Tauri implementation (invoke read_file, dialog, drag-drop, title)
src/pdf/document.ts              — PdfDocument: load bytes, sizes, pages, outline, dest resolution
src/pdf/renderer.ts              — PageRenderer: cancellable page→canvas renders with cache
src/pdf/textlayer.ts             — mountTextLayer(): pdf.js TextLayer into a page element
src/viewer/layout.ts             — pure layout math (page rects, fit scales, visible range, anchoring)
src/viewer/zoom.ts               — pure zoom steps/clamp/format
src/viewer/viewer.ts             — PdfViewer component: virtualised scroll area
src/search/search.ts             — pure text index + matcher
src/search/findbar.ts            — FindBar component + highlight application
src/sidebar/sidebar.ts           — Sidebar shell with Thumbnails/Outline tabs
src/sidebar/thumbnails.ts        — lazy thumbnail list
src/sidebar/outline.ts           — outline tree
src/toolbar/toolbar.ts           — Toolbar: sidebar toggle, page indicator, zoom, rotate, find
src/shortcuts.ts                 — pure resolveShortcut() + bindShortcuts()
src/state/fileState.ts           — per-file last page/zoom persistence (localStorage)
src/ui/icons.ts                  — inline SVG strings
src/styles.css                   — theme tokens, layout, text layer, components
src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/main.rs,src/lib.rs,icons/}
scripts/make-fixtures.py         — generates tests/fixtures/*.pdf (reportlab)
scripts/build-windows.sh         — cross-build + bundle
scripts/smoke-windows.ps1        — launch exe on host, screenshot, exit
tests/unit/*.test.ts             — Vitest
tests/e2e/*.spec.ts              — Playwright
tests/fixtures/{simple.pdf,mixed.pdf,long300.pdf,outline.pdf,encrypted.pdf,broken.pdf,한글 문서.pdf}
```

---

### Task 1: Project scaffold and cross-build pipeline

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/styles.css`, `.gitignore`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/icons/*` (via `tauri icon` from `src-tauri/icon.svg`)
- Create: `scripts/build-windows.sh`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm test` (vitest), `npm run e2e` (playwright, added in Task 8), `scripts/build-windows.sh [--bundle]` producing `src-tauri/target/x86_64-pc-windows-msvc/release/Preview.exe`.
- Produces: Rust command `read_file(path: String) -> Result<tauri::ipc::Response, String>` (raw bytes), `startup_file() -> Option<String>` (first CLI argument that exists on disk).

- [x] **Step 1: Write the failing smoke test** `tests/unit/smoke.test.ts`: `expect(1 + 1).toBe(2)` — exists only to prove the test runner wiring.
- [x] **Step 2: Run `npx vitest run`** — expected: fails because no config/package exists.
- [x] **Step 3: Create `package.json`** with scripts `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test` (`vitest run`), `e2e` (`playwright test`), `tauri`; devDependencies vite, typescript, vitest, @playwright/test, @tauri-apps/cli@^2; dependencies pdfjs-dist (latest 5.x if it exports `TextLayer`, else 4.x), @tauri-apps/api@^2, @tauri-apps/plugin-dialog@^2, @tauri-apps/plugin-window-state@^2. `npm install`.
- [x] **Step 4: Create `vite.config.ts`** (root `.`, `build.outDir: dist`, `build.target: 'chrome120'`, `server.port 1420`, `clearScreen: false`), `tsconfig.json` (strict, ES2022, DOM, `moduleResolution: bundler`), `vitest.config.ts` (environment `node`, include `tests/unit/**`).
- [x] **Step 5: Create `index.html` + `src/main.ts` + `src/styles.css`** — a shell with `<header id="toolbar">`, `<aside id="sidebar">`, `<main id="viewer">`, `<div id="findbar">`; body shows an empty state "Open a PDF" with `Ctrl+O` hint. `main.ts` only sets `document.title = 'Preview'` for now.
- [x] **Step 6: Create the Tauri crate.** `Cargo.toml` name `preview`, lib + bin (`src/lib.rs` with `pub fn run()`, `main.rs` calling it, `windows_subsystem = "windows"` in release); deps `tauri = "2"`, `tauri-plugin-dialog = "2"`, `tauri-plugin-window-state = "2"`, serde, serde_json; release profile `opt-level = "s"`, `lto = true`, `codegen-units = 1`, `strip = true`. Commands `read_file` and `startup_file` as in Interfaces. `tauri.conf.json`: productName `Preview`, identifier `dev.sanghae.preview`, `build.frontendDist ../dist`, `build.devUrl http://localhost:1420`, `build.beforeDevCommand "npm run dev"`, `build.beforeBuildCommand "npm run build"`, one window `{ label: "main", title: "Preview", width: 1100, height: 800, minWidth: 480, minHeight: 360, dragDropEnabled: true, backgroundColor: "#e5e5e7" }`, `app.security.csp null`, bundle `{ active: true, targets: ["nsis"], icon: [...], fileAssociations: [{ ext: ["pdf"], name: "PDF Document", mimeType: "application/pdf", role: "Viewer" }], windows: { nsis: { installMode: "currentUser" } } }`. `capabilities/default.json`: `core:default`, `dialog:default`, `window-state:default`, `core:window:allow-set-title`.
- [x] **Step 7: Create `src-tauri/icon.svg`** (rounded square, neutral gray-blue, white page glyph) and run `npx tauri icon src-tauri/icon.svg` to generate `src-tauri/icons/`.
- [x] **Step 8: Create `scripts/build-windows.sh`**: sets PATH/env from Global Constraints, runs `npm run build`, then `npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc` (add `--no-bundle` unless `--bundle` passed). Prints the exe path and size.
- [x] **Step 9: Run `npx vitest run`** — expected: 1 passed.
- [x] **Step 10: Run `scripts/build-windows.sh`** — expected: `Preview.exe` exists, size well under 15 MB.
- [x] **Step 11: Commit** `chore: scaffold tauri + vite project with cross-build script`.

### Task 2: Reactive store

**Files:**
- Create: `src/store.ts`
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Produces: `createStore<T extends object>(initial: T): Store<T>` with `get(): T`, `set(patch: Partial<T>): void` (shallow merge, notifies only when at least one key changed by `Object.is`), `subscribe(fn: (state: T, prev: T) => void): () => void`, `select<K extends keyof T>(key: K, fn: (v: T[K]) => void): () => void` (fires on change of that key only, and immediately once on subscribe).
- Produces: `ViewerState` type and `initialState` in the same file: `filePath: string | null`, `fileName: string | null`, `numPages: number`, `currentPage: number` (1-based, 0 when no doc), `zoomMode: ZoomMode` (from `src/types.ts`), `scale: number`, `rotation: Rotation` (from `src/types.ts`), `sidebarOpen: boolean`, `sidebarTab: 'thumbnails' | 'outline'`, `findOpen: boolean`, `findQuery: string`, `findTotal: number`, `findIndex: number` (0-based, -1 none), `status: 'empty' | 'loading' | 'ready' | 'error'`, `error: string | null`. Initial: zoomMode `fit-width`, scale 1, sidebarOpen false, sidebarTab thumbnails, status empty.

- [x] **Step 1: Write failing tests**: `set` merges and notifies with `(state, prev)`; `set` with identical values does not notify; `subscribe` returns unsubscribe; `select` fires immediately and then only on that key.
- [x] **Step 2: Run `npx vitest run tests/unit/store.test.ts`** — FAIL (module missing).
- [x] **Step 3: Implement `src/store.ts`.**
- [x] **Step 4: Run tests** — PASS.
- [x] **Step 5: Commit** `feat: add reactive viewer store`.

### Task 3: Layout math

**Files:**
- Create: `src/viewer/layout.ts`
- Test: `tests/unit/layout.test.ts`

**Interfaces:**
- Produces (all pure, CSS px):
  - `CSS_UNITS = 96 / 72`; re-exports `Rotation` and `PageSize` from `src/types.ts` (PDF points, unrotated).
  - `rotatedSize(size: PageSize, rotation: Rotation): PageSize`.
  - `interface LayoutOptions { scale: number; rotation: Rotation; gap: number; padding: number; containerWidth: number }`.
  - `interface PageRect { index: number; top: number; left: number; width: number; height: number }`; `interface Layout { pages: PageRect[]; totalHeight: number; contentWidth: number }`.
  - `computeLayout(sizes: PageSize[], opts: LayoutOptions): Layout` — pages stacked vertically starting at `padding`, separated by `gap`, each centered in `max(containerWidth, width + 2*padding)`; `totalHeight = padding + Σheights + gap*(n-1) + padding`; `contentWidth = max(containerWidth, maxWidth + 2*padding)`.
  - `fitWidthScale(sizes, rotation, containerWidth, padding): number` — widest rotated page fills `containerWidth - 2*padding`.
  - `fitPageScale(sizes, rotation, containerWidth, containerHeight, padding): number` — min of width-fit and height-fit using the largest rotated page dimensions.
  - `visibleRange(layout, scrollTop, viewportHeight, overscan): { first: number; last: number } | null` — inclusive indices of pages intersecting `[scrollTop - overscan, scrollTop + viewportHeight + overscan]`, binary search over `top`.
  - `currentPageIndex(layout, scrollTop, viewportHeight): number` — page with the largest visible height; ties → earlier; empty layout → -1.
  - `scrollTopForPage(layout, index): number` — `page.top - padding` clamped at 0 (so `padding` must be stored in `Layout` as `padding`; add it).
  - `docPointAt(layout, y): { index: number; fraction: number }` — page containing `y`, fraction of its height (clamped 0–1); in a gap, the next page with fraction 0; beyond the end, last page fraction 1.
  - `yForDocPoint(layout, point): number` — inverse.
  - `anchoredScrollTop(oldLayout, newLayout, scrollTop, anchorOffset): number` — keeps the doc point at `scrollTop + anchorOffset` fixed: `yForDocPoint(newLayout, docPointAt(oldLayout, scrollTop + anchorOffset)) - anchorOffset`, clamped ≥ 0.

- [x] **Step 1: Write failing tests** with sizes A4 `{595, 842}`, landscape `{842, 595}`, small `{200, 200}`, scale 1, gap 16, padding 24, containerWidth 1000: assert exact `top/left/width/height` for three pages (width A4 = 595 × 1.3333 = 793.33, centered left = (1000 − 793.33)/2); `rotatedSize` swaps for 90/270; `fitWidthScale` for the mixed set uses 842 pt; `fitPageScale` on a 1000×800 container; `visibleRange` with overscan 0 at scrollTop 0 → `{0,0}`, at scrollTop just below page 1 bottom → starts at 1; `currentPageIndex` at halfway between pages picks the one with more visible height; `docPointAt`/`yForDocPoint` round-trip; `anchoredScrollTop` when scale doubles keeps page 1 fraction 0.5 fixed; empty sizes → `pages: []`, `totalHeight: 2*padding`, `currentPageIndex` -1, `visibleRange` null.
- [x] **Step 2: Run** `npx vitest run tests/unit/layout.test.ts` — FAIL.
- [x] **Step 3: Implement `src/viewer/layout.ts`.**
- [x] **Step 4: Run tests** — PASS.
- [x] **Step 5: Commit** `feat: add pure page layout math`.

### Task 4: Zoom steps

**Files:**
- Create: `src/viewer/zoom.ts`
- Test: `tests/unit/zoom.test.ts`

**Interfaces:**
- Produces: `ZOOM_MIN = 0.1`, `ZOOM_MAX = 8`, `ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8]`, `zoomIn(scale): number` (smallest step > scale + 1e-6, else ZOOM_MAX), `zoomOut(scale): number`, `clampZoom(scale): number`, `formatZoom(scale): string` (`Math.round(scale*100) + '%'`), `wheelZoom(scale, deltaY): number` (multiplicative: `scale * 1.1^(−deltaY/100)` clamped; smooth for trackpads).

- [x] **Step 1: Write failing tests**: `zoomIn(1) === 1.1`, `zoomIn(1.05) === 1.1`, `zoomIn(8) === 8`, `zoomOut(1) === 0.9`, `zoomOut(0.1) === 0.1`, `clampZoom(20) === 8`, `formatZoom(1.333) === '133%'`, `wheelZoom(1, -100)` ≈ 1.1, `wheelZoom(1, 100)` ≈ 0.909.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: add zoom step math`.

### Task 5: Shortcut resolver

**Files:**
- Create: `src/shortcuts.ts`
- Test: `tests/unit/shortcuts.test.ts`

**Interfaces:**
- Produces: `type Action = 'open' | 'find' | 'find-next' | 'find-prev' | 'close-find' | 'zoom-in' | 'zoom-out' | 'zoom-100' | 'fit-width' | 'fit-page' | 'rotate-cw' | 'rotate-ccw' | 'toggle-sidebar' | 'goto-page' | 'next-page' | 'prev-page' | 'first-page' | 'last-page' | 'scroll-down' | 'scroll-up'`.
- `interface KeyLike { key: string; code?: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; inTextField: boolean; findFocused: boolean }`.
- `resolveShortcut(k: KeyLike): Action | null` per Global Constraints; while `inTextField` only Ctrl-combos and Esc resolve, plus Enter/Shift+Enter → find-next/find-prev when `findFocused`; Esc → close-find always when `findFocused`; Alt combos never resolve.
- `bindShortcuts(target: Window, handler: (a: Action, e: KeyboardEvent) => void): () => void` — builds `KeyLike` from the event (`inTextField` = target is input/textarea/contenteditable; `findFocused` = target has `data-find-input`), calls handler and `preventDefault()` only when an action resolved.

- [x] **Step 1: Write failing tests** covering each Action from one key combo, `Ctrl+=` and `Ctrl++` and `Ctrl+Shift+=` → zoom-in, `Ctrl+-` → zoom-out, Space vs Shift+Space, Space in a text field → null, Enter in find → find-next, Esc in find → close-find, `Alt+F` → null.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: add keyboard shortcut resolver`.

### Task 6: Search matcher

**Files:**
- Create: `src/search/search.ts`
- Test: `tests/unit/search.test.ts`

**Interfaces:**
- Produces: `interface TextItemLike { str: string; hasEOL?: boolean }`; `interface PageTextIndex { pageIndex: number; text: string; itemStarts: number[] }` (`text` = items joined, `'\n'` appended after items with `hasEOL`; `itemStarts[i]` = offset of item i in `text`).
- `buildPageIndex(pageIndex: number, items: TextItemLike[]): PageTextIndex`.
- `interface Match { pageIndex: number; start: number; end: number }`.
- `findMatches(query: string, pages: PageTextIndex[]): Match[]` — case-insensitive via `toLowerCase()` on NFKC-normalised strings, any whitespace run in the query matches any whitespace run (including newline) in the text; empty/whitespace-only query → `[]`; ordered by page then start.
- `interface ItemSpan { item: number; start: number; end: number }`; `matchToItemSpans(index: PageTextIndex, m: Match): ItemSpan[]` — splits a match across the items it covers, offsets relative to each item string.

- [x] **Step 1: Write failing tests**: index offsets with and without `hasEOL`; query `"hello world"` matches `"Hello\nworld"`; Korean query matches Korean text; `matchToItemSpans` for a match spanning two items returns two spans with correct local offsets; empty query → `[]`.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: add text search matcher`.

### Task 7: Per-file state persistence

**Files:**
- Create: `src/platform/types.ts`, `src/state/fileState.ts`
- Test: `tests/unit/fileState.test.ts`

**Interfaces:**
- Produces (`types.ts`): `interface FileState { page: number; zoomMode: ZoomMode; scale: number; rotation: Rotation; updatedAt: number }` (types imported from `src/types.ts`, never from `store.ts`); `interface Platform { readFile(path: string): Promise<Uint8Array>; openFileDialog(): Promise<string | null>; startupFile(): Promise<string | null>; onFileDrop(cb: (path: string) => void): () => void; setTitle(title: string): Promise<void>; fileName(path: string): string }`.
- Produces (`fileState.ts`): `loadFileState(path: string, storage?: StorageLike): FileState | null`, `saveFileState(path: string, state: Omit<FileState,'updatedAt'>, storage?: StorageLike): void`, key `pfw:file:` + path, keeps at most 200 entries (evicts oldest `updatedAt`), every storage access wrapped in try/catch, `StorageLike = Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>`.

- [x] **Step 1: Write failing tests** with an in-memory `StorageLike`: round trip; missing → null; corrupt JSON → null; 201st entry evicts the oldest; throwing storage does not throw.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: persist last page and zoom per file`.

### Task 8: PDF document wrapper, fixtures, Playwright setup

**Files:**
- Create: `scripts/make-fixtures.py`, `tests/fixtures/*.pdf` (listed in File Structure), `src/pdf/document.ts`, `src/pdf/renderer.ts`, `playwright.config.ts`, `src/platform/browser.ts`
- Test: `tests/unit/document.test.ts` (Node, legacy pdf.js build), `tests/e2e/_setup.spec.ts` (page loads)

**Interfaces:**
- Produces: `class PdfDocument` with `static load(data: Uint8Array, opts?: { password?: string }): Promise<PdfDocument>` (throws `PdfOpenError` with `kind: 'password' | 'invalid' | 'unknown'` and `message`), `numPages`, `sizes: PageSize[]` (all entries initialised to page 1's size), `loadSizes(onBatch: (from: number, to: number) => void): Promise<void>` (fetches in batches of 25, updates `sizes`, calls `onBatch` per batch; cancels if `destroy()` called), `getPage(index: number): Promise<PDFPageProxy>` (memoised), `getOutline(): Promise<OutlineNode[]>` with `OutlineNode { title: string; pageIndex: number | null; top: number | null; children: OutlineNode[] }` (dests resolved eagerly, failures → `pageIndex: null`), `getPageText(index): Promise<TextItemLike[]>` (memoised), `destroy()`.
- Produces: `class PageRenderer` with `constructor(doc: PdfDocument)`, `render(opts: { index: number; scale: number; rotation: Rotation; canvas: HTMLCanvasElement; dpr: number }): { done: Promise<void>; cancel(): void }` — sizes `canvas.width/height` = CSS × dpr, uses `page.render` with the viewport at `scale * CSS_UNITS * dpr`, one in-flight render per `index` (new render cancels the previous), rejections from cancellation resolve `done` silently.
- Produces: `browserPlatform(): Platform` — `readFile` fetches the path relative to the page (`fetch(encodeURI(path))`), `startupFile` reads `?file=` from `location.search`, `openFileDialog` uses a hidden `<input type=file>` and stores the chosen `File` under a `blob:` path, `onFileDrop` listens to HTML5 drop with files, `setTitle` sets `document.title`, `fileName` = last path segment.
- Fixtures: `simple.pdf` (3 A4 pages, text "Hello world page N"), `mixed.pdf` (A4 portrait, A4 landscape, 200×200), `long300.pdf` (300 pages, page number text), `outline.pdf` (6 pages, nested bookmarks "Chapter 1" → "Section 1.1"), `encrypted.pdf` (user password "secret"), `broken.pdf` (text file with `.pdf` extension), `한글 문서.pdf` (2 pages with Korean text "안녕하세요 미리보기").

- [x] **Step 1: Fixtures already exist** (generated in Task 1 by `scripts/make-fixtures.py` with Noto Sans KR embedded on page 1 and the non-embedded `HYSMyeongJo-Medium` CID font on page 2 of `한글 문서.pdf`). pdf.js therefore needs its CMaps: serve `node_modules/pdfjs-dist/cmaps` and `standard_fonts` at `/pdfjs/cmaps/` and `/pdfjs/standard_fonts/` (dev/preview middleware + copy into `dist/pdfjs/` at build) and pass `cMapUrl`, `cMapPacked: true`, `standardFontDataUrl` to `getDocument`.
- [x] **Step 2: Write failing `tests/unit/document.test.ts`** (Vitest, Node): `PdfDocument.load(simple)` → `numPages 3`, `sizes[0]` ≈ `{595.28, 841.89}`; `mixed` → `loadSizes` ends with `sizes[1].width > sizes[1].height`; `outline` → root title `Chapter 1`, child `Section 1.1` with `pageIndex 1`; `encrypted` without password → rejects with `kind 'password'`; `broken` → `kind 'invalid'`; `getPageText(0)` of simple contains an item whose `str` includes `Hello`. Use `pdfjs-dist/legacy/build/pdf.mjs` under Node via a `vitest` alias when `typeof window === 'undefined'`.
- [x] **Step 3: Run** — FAIL. **Step 4: Implement `document.ts` and `renderer.ts`.** Set `GlobalWorkerOptions.workerSrc` from `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` in browser builds only.
- [x] **Step 5: Run** — PASS.
- [x] **Step 6: Playwright**: `npx playwright install chromium`; `playwright.config.ts` with `webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173' }`, `use: { baseURL, viewport 1200×800 }`, projects `chromium` and `chromium-hidpi` (`deviceScaleFactor: 2`). Vite `publicDir` must expose `tests/fixtures` at `/fixtures` (symlink `public/fixtures` → `../tests/fixtures`, or `vite.config.ts` `publicDir: 'tests'` so files are at `/fixtures/...`; choose the latter).
- [x] **Step 7: Write `tests/e2e/_setup.spec.ts`**: `page.goto('/')` → heading text "Open a PDF" visible. Run `npm run e2e` — PASS. If Chromium fails to launch for missing system libraries, record the exact missing library names in the task notes and fall back to running e2e through `msedge` on the Windows host via Playwright's `channel: 'msedge'` with `executablePath` under `/mnt/c/...` — only if headless Chromium cannot run.
- [x] **Step 8: Commit** `feat: pdf document wrapper, renderer, fixtures and e2e harness`.

### Task 9: Viewer component (virtualised continuous scroll, zoom, rotation)

**Files:**
- Create: `src/viewer/viewer.ts`, `src/pdf/textlayer.ts`, `src/app.ts`; Modify: `src/main.ts`, `src/styles.css`, `index.html`
- Test: `tests/e2e/viewer.spec.ts`

**Interfaces:**
- Consumes: Tasks 2–4, 7, 8.
- Produces: `class PdfViewer` — `constructor(container: HTMLElement, store: Store<ViewerState>)`, `setDocument(doc: PdfDocument | null): Promise<void>`, `goToPage(index: number, top?: number): void` (`top` in PDF points from the page's top edge), `scrollByViewport(dir: 1 | -1): void`, `setZoom(mode: ViewerState['zoomMode'], scale?: number, anchor?: { x: number; y: number }): void` (anchor in viewport CSS px; default = viewport center), `setRotation(r: Rotation): void`, `getMountedPages(): Map<number, HTMLElement>`, `onTextLayer(cb: (index: number, el: HTMLElement, textDivs: HTMLElement[]) => void): () => void`, `destroy()`.
- Produces: `mountTextLayer(page: PDFPageProxy, viewport: PageViewport, host: HTMLElement): Promise<{ textDivs: HTMLElement[]; cancel(): void }>` — uses pdf.js `TextLayer`; sets `--scale-factor` on `host`.
- Produces: `class App` — `constructor(platform: Platform, root: Document)`, `start(): Promise<void>` (opens `startupFile()` if any), `openPath(path: string): Promise<void>` (status loading → ready/error, title, restore `FileState`, `loadSizes` in background), `openBytes(name: string, data: Uint8Array)`, exposes `window.__pfw = { store, viewer, metrics: { openStart, firstPaint } }` for tests.
- Page element contract: `<div class="page" data-page="N" style="position:absolute; top;left;width;height"><canvas></canvas><div class="textLayer"></div></div>`; a page that is not mounted has no element at all; the scroll container has a single `.page-layer` child whose height = `layout.totalHeight`.
- Behaviours: DPR from `devicePixelRatio`, re-render on `resize` (ResizeObserver, debounced 100 ms; fit modes recompute scale); render order: current page, then outward; overscan = 0.5 viewport; renders cancelled on unmount; on zoom the canvas CSS size changes immediately (stretched bitmap) then the re-render replaces it; `currentPage` in store updated from `currentPageIndex` on scroll (rAF-throttled); Ctrl+wheel → `setZoom('custom', wheelZoom(...), {x,y})` with `preventDefault`; `scale` and `zoomMode` written to store whenever they change; `firstPaint` metric recorded when the first canvas render completes.

- [x] **Step 1: Write failing `tests/e2e/viewer.spec.ts`** (open via `/?file=fixtures/<name>.pdf`):
  - `simple.pdf`: `.page[data-page="1"] canvas` present and non-blank (sample via `page.evaluate` reading `getImageData` from the canvas, count of non-white pixels > 100); `__pfw.store.get().numPages === 3`; `metrics.firstPaint - metrics.openStart < 1000`.
  - `long300.pdf`: after load, `document.querySelectorAll('.page').length <= 10`; scroll to `layout`-middle (`__pfw.viewer.goToPage(149)`) → `currentPage === 150` and mounted count still ≤ 10; `firstPaint - openStart < 1000`.
  - `mixed.pdf`: every `.page` has `left + width/2` within 1px of container center; after `setZoom('fit-width')` the landscape page width ≈ container width − 2×padding.
  - Zoom anchoring: at page 150 of `long300`, `setZoom('custom', 2)` → `currentPage` still 150; wheel with ctrl at (600, 400) keeps the doc point (compare `docPointAt` before/after through `__pfw.viewer`).
  - Rotation: `setRotation(90)` on `simple` → page element width > height.
  - HiDPI project: `canvas.width === Math.round(canvas.clientWidth * 2)`.
  - `broken.pdf` → `status 'error'`, `.error-banner` visible containing "broken.pdf"; `encrypted.pdf` → `error` mentions password.
- [x] **Step 2: Run** `npm run e2e` — FAIL.
- [x] **Step 3: Implement `textlayer.ts`, `viewer.ts`, `app.ts`, styles** (theme tokens: `--bg`, `--surface`, `--page-shadow`, `--fg`, `--accent`, dark overrides under `prefers-color-scheme: dark`; text layer CSS copied from pdf.js `pdf_viewer.css` `.textLayer` rules).
- [x] **Step 4: Run** — PASS on both projects.
- [x] **Step 5: Commit** `feat: virtualised pdf viewer with zoom, rotation and text layer`.

### Task 10: Toolbar, page indicator, empty state, open flows

**Files:**
- Create: `src/toolbar/toolbar.ts`, `src/ui/icons.ts`; Modify: `src/app.ts`, `src/styles.css`, `index.html`, `src/platform/browser.ts`
- Test: `tests/e2e/toolbar.spec.ts`

**Interfaces:**
- Consumes: `PdfViewer`, `Store`, Task 4 zoom.
- Produces: `class Toolbar` — `constructor(host: HTMLElement, store, actions: ToolbarActions)` where `ToolbarActions = { toggleSidebar(); gotoPage(n: number); zoomIn(); zoomOut(); setZoom(mode, scale?); rotate(); toggleFind(); open() }`; DOM: `button[data-action=sidebar]`, `input[data-page-input]` + `span[data-page-total]`, `button[data-action=zoom-out]`, `button[data-zoom-menu]` (label = `formatZoom(scale)` or "Fit Width"/"Fit Page") opening a `div[role=menu]` with items `Fit Width`, `Fit Page`, `50%`, `75%`, `100%`, `125%`, `150%`, `200%`, `400%`; `button[data-action=zoom-in]`, `button[data-action=rotate]`, `button[data-action=find]`. Page input commits on Enter (clamped 1..numPages), blurs on Esc, reverts on blur without Enter. Buttons have `title` tooltips with the shortcut.
- Empty state: `section.empty-state` with "Open a PDF" heading, `button[data-action=open]` "Open…", hint "or drop a file here". Dragging a file over the window shows `.drop-overlay`.
- App: `open()` → `platform.openFileDialog()` → `openPath`; native/HTML5 drops → `openPath`; title = `fileName`.

- [x] **Step 1: Write failing e2e**: page input `150` + Enter on `long300` → `currentPage 150`; `999` → clamps to 300; zoom-in button changes `formatZoom` label; zoom menu "Fit Page" → `zoomMode 'fit-page'`; rotate button → `rotation 90`; sidebar button toggles `sidebarOpen`; `/?file=fixtures/한글 문서.pdf` → `document.title === '한글 문서.pdf'`; HTML5 drop of `simple.pdf` (Playwright `setInputFiles` on the hidden input via the Open button) → `numPages 3`; empty state visible on `/` with no file.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: toolbar, page indicator, zoom menu and open flows`.

### Task 11: Sidebar — thumbnails and outline

**Files:**
- Create: `src/sidebar/sidebar.ts`, `src/sidebar/thumbnails.ts`, `src/sidebar/outline.ts`; Modify: `src/app.ts`, `src/styles.css`
- Test: `tests/e2e/sidebar.spec.ts`

**Interfaces:**
- Consumes: `PdfDocument.getOutline()`, `PageRenderer`, `PdfViewer.goToPage`.
- Produces: `class Sidebar` — `constructor(host, store, deps: { renderer: PageRenderer | null; doc: PdfDocument | null; goToPage(index: number, top?: number): void })`, `setDocument(doc, renderer)`; tabs `button[data-tab=thumbnails]`, `button[data-tab=outline]` (outline tab disabled with title "No outline" when empty; defaults to outline tab when the doc has one? No — default stays thumbnails); width 220 px; hidden entirely when `sidebarOpen` false (main area expands; viewer re-fits).
- `ThumbnailList`: one `button.thumb[data-page=N]` per page with a `<canvas>` rendered lazily at 160 px width via `IntersectionObserver` (root = sidebar scroller, rootMargin 400px), rendered through a separate `PageRenderer` instance so main-view renders are not cancelled; `.thumb.current` follows `currentPage` and is scrolled into view (`block: 'nearest'`).
- `OutlineTree`: nested `<ul>` with `button.outline-item[data-page]`; items with children get a disclosure toggle; top-level expanded, deeper levels collapsed; click → `goToPage(pageIndex, top ?? undefined)`.

- [x] **Step 1: Write failing e2e**: open `long300` with sidebar → thumbnails count 300, canvases rendered only for visible ones (`canvas.width > 0` count < 40); click thumb 42 → `currentPage 42`; `goToPage(199)` → `.thumb.current` is page 200 and within sidebar viewport; `outline.pdf` outline tab → "Chapter 1" visible, expanding shows "Section 1.1", clicking goes to `currentPage 2`; `simple.pdf` → outline tab disabled.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: sidebar with lazy thumbnails and outline`.

### Task 12: Find bar

**Files:**
- Create: `src/search/findbar.ts`; Modify: `src/app.ts`, `src/viewer/viewer.ts` (expose text layer hook if not already), `src/styles.css`
- Test: `tests/e2e/find.spec.ts`

**Interfaces:**
- Consumes: Task 6 matcher, `PdfDocument.getPageText`, `PdfViewer.onTextLayer`, `goToPage`.
- Produces: `class FindBar` — `constructor(host, store, deps: { doc, viewer })`; DOM `input[data-find-input]`, `span[data-find-count]` ("3 of 12", "No results", empty while idle), `button[data-action=find-prev]`, `button[data-action=find-next]`, `button[data-action=find-close]`; `open()` focuses and selects the input; `close()` clears highlights and store find fields; search runs debounced 150 ms after typing, builds the text index lazily (all pages, batches of 10, memoised on the doc); current match → `goToPage(pageIndex, topOfMatchFromTextDiv)` then `mark.find-current` scrolled into view; highlights applied to mounted text layers by wrapping ranges in `<mark class="find-match">` and re-applied whenever `onTextLayer` fires for a page with matches.
- Verify in `node_modules/pdfjs-dist` that `TextLayer.textDivs[i]` corresponds to text content item `i` (document the finding in a code comment in `findbar.ts`; if not 1:1, use the `textDivProperties`/`textContentItemsStr` mapping instead).

- [x] **Step 1: Write failing e2e** on `simple.pdf`: Ctrl+F opens and focuses input; type `page 2` → count "1 of 1", `currentPage 2`, one `mark.find-current`; type `hello` → "1 of 3"; Enter → "2 of 3"; Shift+Enter → "1 of 3"; Esc → bar hidden, no `mark` left; `한글 문서.pdf` query `미리보기` → "1 of 2" or more; query `zzzz` → "No results".
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: find in document with highlights`.

### Task 13: Shortcut binding and state restore

**Files:**
- Modify: `src/app.ts`, `src/shortcuts.ts` (binder already exists), `src/viewer/viewer.ts`
- Test: `tests/e2e/shortcuts.spec.ts`

**Interfaces:**
- Consumes: Task 5 `bindShortcuts`, Task 7 `loadFileState/saveFileState`.
- Behaviours: every `Action` dispatches to the matching App/viewer method; `goto-page` focuses the page input; `saveFileState` debounced 300 ms on `currentPage/scale/zoomMode/rotation` changes; on `openPath` of a known path restore page + zoom + rotation (page restored after the layout exists).

- [x] **Step 1: Write failing e2e**: on `long300` press `End` → 300, `Home` → 1, `PageDown` → 2, `Space` → `scrollTop` increased by ≈ viewport height, `Ctrl+0` → scale 1 custom, `Ctrl+1` → fit-width, `Ctrl+2` → fit-page, `Ctrl+L` → rotation 90, `Ctrl+Shift+S` → sidebar; reload the same URL → `currentPage` restored to the page set before reload and rotation 90 restored.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat: keyboard shortcuts and per-file state restore`.

### Task 14: Tauri platform, window state, packaging, Windows smoke test

**Files:**
- Create: `src/platform/tauri.ts`, `scripts/smoke-windows.ps1`; Modify: `src/main.ts`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `scripts/build-windows.sh`
- Test: manual-but-scripted smoke on the Windows host

**Interfaces:**
- Produces: `tauriPlatform(): Platform` — `readFile` = `invoke<ArrayBuffer>('read_file', { path })` → `new Uint8Array(buf)`; `openFileDialog` = `@tauri-apps/plugin-dialog` `open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] })`; `startupFile` = `invoke('startup_file')`; `onFileDrop` = `getCurrentWebview().onDragDropEvent` (`type === 'drop'` → first `.pdf` path; `enter/over` → `.drop-overlay` shown via a `dragState` callback added to the Platform interface as `onDragState(cb: (over: boolean) => void)`), `setTitle` = `getCurrentWindow().setTitle`.
- `main.ts`: `'__TAURI_INTERNALS__' in window ? tauriPlatform() : browserPlatform()`.
- Rust: register `tauri_plugin_dialog` and `tauri_plugin_window_state` (`Builder::default().build()`); `read_file` reads with `std::fs::read` and returns `tauri::ipc::Response::new(bytes)`; `startup_file` returns the first argument after the exe that is an existing file, canonicalised and with the `\\?\` prefix stripped.
- `smoke-windows.ps1 <exe> <pdf>`: starts the exe with the pdf path, waits 4 s, captures the primary screen to `smoke.png` with `System.Drawing`, checks the process is still alive, then stops it. The build script copies the fixture `한글 문서.pdf` to `C:\Users\Public\pfw-smoke\` for the launch.

- [x] **Step 1: Implement `tauri.ts`, Rust commands, plugin registration, capabilities.**
- [x] **Step 2: Run `scripts/build-windows.sh --bundle`** — expected: `Preview.exe` and `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Preview_0.1.0_x64-setup.exe` exist. If NSIS bundling fails on Linux, keep the portable exe as the deliverable and record the failure in `docs/superpowers/plans/` notes.
- [x] **Step 3: Run the smoke script from WSL** with the fixture `한글 문서.pdf`; `Read` the screenshot; expected: a window titled `한글 문서.pdf` showing Korean text on a rendered page, no error banner.
- [x] **Step 4: Measure startup**: run the exe with `long300.pdf`, screenshot at 1.0 s; expected: first page visible.
- [x] **Step 5: Commit** `feat: tauri platform, window state and windows packaging`.

### Task 15: README, final verification and review

**Files:**
- Modify: `README.md`; Create: `docs/superpowers/plans/2026-10-26-pdf-viewer-notes.md` (what was verified where, known gaps)

- [ ] **Step 1: README**: what it is, screenshot, features, shortcuts table, build instructions (WSL cross-build), install/portable notes, non-goals.
- [ ] **Step 2: Run `npm test`, `npm run e2e`, `cargo fmt --check` (in `src-tauri`), `scripts/build-windows.sh --bundle`** — all pass.
- [ ] **Step 3: Request a fresh-context code review** (superpowers:requesting-code-review) of the whole branch; fix anything blocking.
- [ ] **Step 4: Commit** `docs: readme and verification notes`.
