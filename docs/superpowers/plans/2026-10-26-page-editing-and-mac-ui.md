# Page Editing and Mac-style UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only viewer into a Preview-style page editor (select, drag-reorder, delete, copy/cut/paste, merge files, undo, save) and give it a Mac-like look.

**Architecture:** An `EditableDocument` composes pages from one or more pdf.js sources through an immutable page list; all viewing components read through a `PageSource` interface, so edits never re-parse PDFs. `@cantoo/pdf-lib` writes the composition to disk with link, outline and metadata handling. The UI gets a unified 52px title/toolbar, Mica materials on Windows 11, Inter, Mac-style menus and alerts.

**Tech Stack:** as v1 plus `@cantoo/pdf-lib@2.11`, Rust `clipboard-win@5`, Inter 4.1 (OFL).

**Spec:** `docs/superpowers/specs/2026-10-26-page-editing-and-mac-ui-design.md` (builds on `2026-10-26-pdf-viewer-design.md` and the v1 plan `2026-10-26-pdf-viewer.md`).

## Global Constraints

- Everything from the v1 plan's Global Constraints still holds except the shortcut changes below.
- Shortcut changes: Ctrl+S save; Ctrl+Shift+S save as; Ctrl+Alt+S toggle sidebar; Ctrl+Z undo; Ctrl+Y and Ctrl+Shift+Z redo; Ctrl+W close window; in the focused sidebar Ctrl+A select all pages, Ctrl+C / Ctrl+X copy / cut pages, Delete and Backspace delete pages, arrows move the selection (Shift extends). Ctrl+V pastes pages when focus is in the sidebar or anywhere outside a text field.
- Edits must not re-render pages that did not move into view; the viewer and thumbnails reuse elements by `pageKey`.
- No in-page HTML5 drag-and-drop (it is disabled inside WebView2 while Tauri file drop is on). Use pointer events.
- Page identity: `PageRef.id` is unique per window session and never reused; `pageKey = "<src>:<index>"` identifies the underlying page for render reuse.
- Every new UI string is English, matching v1.
- Playwright: each worktree uses its own `PW_PORT` (never 4173).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Unsaved edits are never lost: closing, Ctrl+W, opening into the same window and replacing the document all ask first. Test in Task D6.
2. A saved file contains no page objects outside its page tree, and links point at pages inside it. Test in Task C2.
3. Dragging a selection into a gap inside itself, to the very start, or to the very end produces the expected order, and dropping where it started is a no-op that does not mark the document edited. Tests in Task A1 and D3.
4. Undo after save brings back "— Edited"; redo to the saved state clears it. Tests in Task A2 and D6.
5. Merging a password-protected PDF prompts for its password and the merged pages save correctly. Tests in Task C2 and D5.
6. A 300-page document stays responsive: deleting or moving pages re-renders only visible pages, and at most ~10 page canvases are mounted. Test in Task D1.

---

## File Structure (new or substantially changed)

```
src/edit/composition.ts     — PageRef, pure move/delete/insert ops            (Task A1)
src/edit/history.ts         — undo/redo stack with saved-state tracking        (Task A2)
src/edit/selection.ts       — click/ctrl/shift selection over ordered ids      (Task A3)
src/edit/outlineRemap.ts    — source outlines → composition positions         (Task A4)
src/shortcuts.ts            — new actions + inSidebar                          (Task A5)
src/edit/writer.ts          — composition → PDF bytes (pdf-lib)                (Task C2)
src/edit/document.ts        — EditableDocument implements PageSource           (Task C3)
src/pdf/source.ts           — PageSource interface                             (Task 0)
src/ui/menu.ts              — Mac-style menu                                   (Task B2)
src/ui/dialog.ts            — Mac-style alert                                  (Task B2)
src/ui/icons.ts             — SF-like icon set                                 (Task B1)
src/assets/fonts/           — InterVariable.woff2 + OFL.txt                     (Task 0)
src/toolbar/toolbar.ts      — unified title/toolbar                            (Task B3)
src/sidebar/*.ts            — selection, drag, context menu, drop target       (Task D2–D5)
src-tauri/src/lib.rs        — write_file, clipboard, open_window, Mica         (Task C4)
tests/unit/{composition,history,selection,outlineRemap,writer}.test.ts
tests/e2e/{editing,merge,save,chrome}.spec.ts
```

---

### Task 0: Contracts on main (before branching)

**Files:** `src/pdf/source.ts`, `src/platform/types.ts`, `src/platform/browser.ts`, `src/platform/tauri.ts`, `src/store.ts`, `src/pdf/document.ts`, `src/app.ts`, `package.json`, `src/assets/fonts/*`

**Interfaces (produced, every later task relies on these exact names):**

```ts
// src/pdf/source.ts
export interface PageSource {
  readonly numPages: number;
  readonly sizes: PageSize[];
  getPage(index: number): Promise<PDFPageProxy>;
  getTextContent(index: number): Promise<TextContent>;
  getPageText(index: number): Promise<PageText>;
  getOutline(): Promise<OutlineNode[]>;
  /** "<src>:<sourcePageIndex>"; equal keys render identically. */
  pageKey(index: number): string;
}

// src/platform/types.ts additions
export interface Point { x: number; y: number }            // CSS px, viewport coordinates
export interface DragState { over: boolean; point: Point | null; paths: string[] }
export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;                                    // goes through onCloseRequested
  isMaximized(): Promise<boolean>;
  onMaximizedChange(cb: (maximized: boolean) => void): () => void;
}
// Platform changes:
onFileDrop(cb: (paths: string[], point: Point | null) => void): () => void;   // was (path)
onDragState(cb: (state: DragState) => void): () => void;                      // was (over)
openFilesDialog(): Promise<string[]>;                                         // multi-select PDFs
saveFileDialog(defaultPath: string): Promise<string | null>;
writeFile(path: string, data: Uint8Array): Promise<void>;
openInNewWindow(path: string): Promise<boolean>;                              // false = unsupported
clipboardWritePdf(data: Uint8Array): Promise<void>;
/** PDF paths on the clipboard, or null when it still holds this window's own last copy. */
clipboardReadPdfPaths(): Promise<string[] | null>;
onCloseRequested(cb: () => Promise<boolean>): void;                           // resolve true = close
readonly windowControls: WindowControls | null;
readonly material: 'mica' | 'none';
```

Store: add `dirty: boolean` (initial `false`). `PdfDocument` gains `pageKey(i) => "0:" + i`, `getData(): Promise<Uint8Array>` (raw bytes from pdf.js) and remembers the password it was opened with (`readonly password: string | undefined`).

Browser shim behaviour (test hooks, all on `window`):
- `__pfwFiles: Map<string, Uint8Array>` — `writeFile` stores here; `readFile` checks it first.
- `__pfwNextSavePath: string | null` — returned by `saveFileDialog`.
- `__pfwNextOpenPaths: string[] | null` — returned by `openFilesDialog` when set, else a hidden `<input type=file multiple>`.
- `__pfwExternalClipboard: string[] | null` — when set, `clipboardReadPdfPaths` returns it (simulates another window's copy); otherwise returns `null`.
- `__pfwRequestClose(): Promise<boolean>` — runs the registered close callback.
- HTML5 drop on the window reports `paths` (blob keys) and the drop `point`.
- `windowControls = null`, `material = 'none'`.

Tauri platform: implement everything except `writeFile`, `clipboard*`, `openInNewWindow`, `material` (stubs that throw `not implemented`, `material: 'none'`; filled by Task C4). `onFileDrop`/`onDragState` convert the physical drop position to CSS px by dividing by `devicePixelRatio`.

- [x] Install `@cantoo/pdf-lib@2.11.1`; add Inter 4.1 `InterVariable.woff2` and `InterVariable-Italic`-free subset (just the upright variable file) with `OFL.txt` under `src/assets/fonts/`.
- [x] Add the interfaces and shim behaviour; adapt `App` to the new drop signature (drop with no document opens the first PDF in place; with a document, opens it via `openInNewWindow`, falling back to in-place open when that returns false).
- [x] `npm run build`, `npm test`, `npm run e2e` all green; commit `chore: contracts for page editing and mac ui`.

### Task A1–A5 (worktree `edit-core`, agent): pure editing modules

All pure TypeScript, no DOM, Vitest only.

**A1 `src/edit/composition.ts`**
```ts
export interface PageRef { readonly id: number; readonly src: number; readonly index: number }
export type Composition = readonly PageRef[];
export function idSource(start?: number): () => number;            // 1, 2, 3, … (start default 1)
export function fromSource(src: number, count: number, nextId: () => number): Composition;
/** Moves the pages whose ids are in `ids` (keeping their relative order) into gap `gap`
 *  of the ORIGINAL composition (0 = before the first page, length = after the last).
 *  Returns the same array instance when nothing changes. */
export function movePages(c: Composition, ids: ReadonlySet<number>, gap: number): Composition;
/** Returns the same instance when `ids` is empty or would delete every page. */
export function deletePages(c: Composition, ids: ReadonlySet<number>): Composition;
export function insertPages(c: Composition, gap: number, refs: ReadonlyArray<{ src: number; index: number }>,
  nextId: () => number): { pages: Composition; ids: number[] };
export function canDelete(c: Composition, ids: ReadonlySet<number>): boolean;
export function samePages(a: Composition, b: Composition): boolean;  // same ids in same order
```
Tests (exact cases): ids 1..6 → move {2,3} to gap 0 → [2,3,1,4,5,6]; to gap 6 → [1,4,5,6,2,3]; to gap 5 → [1,4,5,2,3,6]; {2,5} to gap 3 → [1,3,2,5,4,6]; {2,3} to gap 2 or 3 (inside/adjacent to itself) → same instance; move all → same instance; delete {2} → [1,3,4,5,6]; delete all → same instance; insert two refs at gap 1 → new ids 7,8 at positions 1,2; inserting the same {src,index} twice yields distinct ids.

**A2 `src/edit/history.ts`**
```ts
export class History<T> {
  constructor(initial: T, limit?: number);          // limit default 200 undo steps
  get current(): T;
  push(next: T): void;                              // clears redo
  undo(): T | null; redo(): T | null;
  get canUndo(): boolean; get canRedo(): boolean;
  markSaved(): void; get dirty(): boolean;          // dirty = current entry is not the saved entry
  reset(initial: T): void;                          // new document: clean, empty stacks
}
```
Tests: push/undo/redo; push after undo drops redo; dirty after push, clean after markSaved, dirty after undo past save, clean after redo back to it; if the saved entry is dropped by `limit` or by a push after undo, `dirty` stays true until the next `markSaved`.

**A3 `src/edit/selection.ts`**
```ts
export class Selection {
  get ids(): ReadonlySet<number>; get anchor(): number | null; get size(): number;
  has(id: number): boolean;
  click(id: number, order: readonly number[], mods: { ctrl: boolean; shift: boolean }): void;
  selectOnly(id: number): void; set(ids: Iterable<number>, anchor?: number): void;
  selectAll(order: readonly number[]): void; clear(): void;
  /** Moves to the neighbour of the anchor/last-focused id; with `extend`, grows/shrinks the range. */
  step(dir: 1 | -1, order: readonly number[], extend: boolean): number | null;  // returns the new focus id
  prune(order: readonly number[]): void;            // drop ids no longer present
}
```
Semantics: plain click → only that id, anchor = id. Ctrl → toggle id, anchor = id. Shift → range anchor..id replaces selection. Ctrl+Shift → range is added. No anchor → shift acts as plain. `step` without selection selects the first (dir 1) or last (dir −1) id.

**A4 `src/edit/outlineRemap.ts`**
```ts
import type { OutlineNode } from '../pdf/document';
export interface SourceOutline { src: number; nodes: OutlineNode[] }   // pageIndex = source page index
export function remapOutline(outlines: SourceOutline[], pages: Composition): OutlineNode[];
```
Rules: a node's `pageIndex` becomes the position of the first `PageRef` with the same `src` and `index`, `top` kept. If its page is gone: drop it unless a child survives, then keep it with the first surviving descendant's `pageIndex` and `top: null`. Nodes with `pageIndex: null` keep `null` only if they have surviving children, else dropped. Sources contribute in order of their first page's position; sources without pages contribute nothing.

**A5 `src/shortcuts.ts`**: add actions `'save' | 'save-as' | 'undo' | 'redo' | 'close-window' | 'select-all-pages' | 'copy-pages' | 'cut-pages' | 'paste-pages' | 'delete-pages'`; add `inSidebar: boolean` to `KeyLike` (`keyLikeFromEvent` sets it when the target is inside `#sidebar`). Rules per Global Constraints. In the sidebar, arrows, Home and End resolve to `null` (the sidebar handles them). `toggle-sidebar` moves to Ctrl+Alt+S (Alt combos stay null otherwise). Undo/redo resolve to null inside text fields. Update existing tests accordingly.

- [x] For each of A1–A5: failing test → implement → `npx vitest run` → commit (`feat: composition ops`, `feat: edit history`, `feat: thumbnail selection model`, `feat: outline remapping`, `feat: editing shortcuts`). Finish with `npm run build` and `npm test` green.

### Task B1–B5 (worktree `mac-ui`, agent): Mac-style visual redesign

Visual direction (binding): macOS Sonoma/Sequoia Preview.
- Tokens on `:root` with dark overrides as in v1. Light: document area `#e8e8e8`, chrome `#f6f6f6`, hairline `rgba(0,0,0,.1)`, text `rgba(0,0,0,.85)`, secondary `rgba(0,0,0,.5)`, accent `#0a64d8`/`#007aff`. Dark: document `#1e1e1e`, chrome `#2c2c2e`, hairline `rgba(255,255,255,.1)`, text `rgba(255,255,255,.88)`, accent `#0a84ff`. Radii 6px controls, 8px menus, 12px alerts. Font `"Inter", "Malgun Gothic", system-ui` via `@font-face` from `src/assets/fonts/InterVariable.woff2`; base 13px; `font-feature-settings: "cv11", "ss01"` optional.
- `:root[data-material="mica"]`: chrome and sidebar backgrounds become translucent (`rgba(246,246,246,.6)` light / `rgba(32,32,32,.55)` dark), body background transparent, document area stays opaque. Set by `main.ts` from `platform.material`.

**B1** icons and tokens: replace `src/ui/icons.ts` with an SF-like set at 18px, stroke 1.5, round caps (sidebar, zoom-in, zoom-out, rotate-left, ellipsis, search, chevron-up/down/left/right, close-small, page/document, xmark-circle-fill for search clear). Paths may be derived from Lucide (ISC) with the license text added to `src/ui/ICONS-LICENSE.txt`.

**B2** `src/ui/menu.ts` and `src/ui/dialog.ts`:
```ts
export type MenuItem =
  | { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; radio?: boolean; action: () => void }
  | 'separator';
/** Opens at `at` (anchor rect: below it, left-aligned; point: at it). Resolves when closed. */
export function showMenu(at: DOMRect | Point, items: MenuItem[], opts?: { minWidth?: number }): Promise<void>;
export interface AlertButton { label: string; value: string; primary?: boolean; cancel?: boolean }
export function showAlert(opts: { title: string; message?: string; buttons: AlertButton[];
  input?: { type: 'password' | 'text'; placeholder?: string; value?: string } }):
  Promise<{ value: string; input?: string }>;   // Esc → the cancel button's value; Enter → primary
```
Menu: `role="menu"`, items `role="menuitem"` or `menuitemradio` with `aria-checked`, arrow keys/Enter/Esc, click outside closes, closes on window blur/resize, stays inside the viewport. Alert: modal with scrim, focus trapped, app icon on top, bold title, message, full-width stacked buttons when 3+ (Mac style), side-by-side when 2. Expose `window.__pfwUi = { showMenu, showAlert }` for tests. E2E `tests/e2e/ui.spec.ts`: menu keyboard navigation and outside-click; alert returns the clicked value, Esc returns cancel, Enter returns primary, password input value is returned.

**B3** unified toolbar (`src/toolbar/toolbar.ts`, `index.html`, `src/styles.css`):
- Height 52px, `data-tauri-drag-region` on the bar and the title block background (not on controls).
- Left: sidebar toggle; title block: `[data-doc-title]` file name (13px/600) + `[data-doc-edited]` " — Edited" (secondary, shown when `store.dirty`); subtitle 11px secondary: `Page <input data-page-input> of <span data-page-total>`; with no document the title is "Preview" and the subtitle is hidden.
- Right: segmented control `[data-action="zoom-out"]|[data-action="zoom-in"]`, zoom pill `[data-zoom-menu]` using `showMenu` with `menuitemradio` items (Fit Width, Fit Page, 50%, 75%, 100%, 125%, 150%, 200%, 400%), `[data-action="rotate"]`, `[data-action="more"]` ⋯ button that calls a `moreMenu()` action supplied by the App (Toolbar gets `actions.moreMenu(anchor: DOMRect)`), `[data-action="find"]` search button; then caption buttons when `platform.windowControls` exists: `[data-window="minimize"]`, `[data-window="maximize"]` (icon swaps to restore when maximized), `[data-window="close"]` (hover red `#c42b1c`, white glyph), 46×52, glyphs from "Segoe Fluent Icons", "Segoe MDL2 Assets" (E921, E922, E923, E8BB). Without window controls (browser) they are absent.
- Move `#findbar` into the toolbar right side: it replaces the search button when open (search glyph inside a rounded 28px field, clear button, count, chevrons), keeps every `data-*` hook from v1, and `#findbar` hidden/visible semantics stay the same. Width 220px, animates in.
- `ToolbarActions` gains `moreMenu(anchor: DOMRect): void`; the App passes a stub that shows Open… only until Task D wires the rest.
- Keep all v1 e2e passing; update selectors only where elements moved (toolbar open button now lives in the ⋯ menu: tests open it via the ⋯ button).

**B4** sidebar look: 200px wide, padding 12px; segmented control `[data-tab="thumbnails"]|[data-tab="outline"]` with `.active`; thumbnails centered, 1px hairline + soft shadow, label under each; CSS-only states the editing branch will toggle: `.thumb.selected` (rounded 8px highlight behind thumbnail; label becomes capsule), `#sidebar:focus-within .thumb.selected` accent color vs gray otherwise, `.thumb.current` (subtle outline when not selected), `.thumb.dragging` (40% opacity), `.drop-indicator` (2px accent line, rounded ends, absolutely positioned inside the thumbnail list, hidden by default), `.drag-ghost` (fixed-position stack of up to 3 thumbnail images with 6px offsets and a red count badge `.drag-count`). Outline rows 24px with disclosure chevrons. Provide a static demo of these classes in the visual review screenshots (toggle classes via `page.evaluate`).

**B5** empty state (app icon tile, "Open a PDF", primary blue "Open…" button, hint), error toast (top-center, translucent, rounded 10px, icon), loading cue, and the password panel restyled as a Mac alert (CSS only; DOM and classes unchanged). Visual review: screenshots light/dark of empty, document, sidebar+selection demo, zoom menu, alert into `docs/screenshots/` (PNG) — these are the deliverable reviewers look at.

- [x] One commit per B-task; full `npm run e2e` (with `PW_PORT=4185`) and `npm test` green at the end.

### Task C1–C4 (worktree `pdf-writer`, coordinator): saving engine and native side

**C1** fixtures: `scripts/make-fixtures.py` adds `links.pdf` (page 1 "Contents" with links to pages 2–4 by named destination; pages "Page A/B/C") and `links-explicit.pdf` (same, explicit `[pageRef /Fit]` destinations, via pypdf post-processing).

**C2** `src/edit/writer.ts`
```ts
export interface WriterSource { id: number; bytes: Uint8Array; password?: string }
export interface WriteMeta { title?: string; author?: string; subject?: string; keywords?: string }
export async function writePdf(sources: WriterSource[], pages: Composition,
  opts: { outline: OutlineNode[]; meta?: WriteMeta }): Promise<Uint8Array>;
```
Algorithm: load each needed source with `@cantoo/pdf-lib` (`password`, `ignoreEncryption: false`, `updateMetadata: false`). Pre-pass per source: for every page's `/Annots`, record and remove `/P`, and for link annotations resolve `/Dest` (explicit array, name or string via catalog `/Dests` or `/Names /Dests` tree) and `/A <</S /GoTo /D …>>` to a source page index; replace the destination with `null` before copying. Copy pages grouped per source with one `copyPages` call per source (pdf-lib requires that for shared resources), then add them in composition order; a source page used twice is copied twice. Post-pass: walk each output page's annotations in parallel with its source page's; restore `/P` to the new page ref; set link destinations to `[newRef, …rest]` when the target page is in the output (first occurrence), otherwise delete the link annotation. Write the outline (`/Outlines` with `/First /Last /Next /Prev /Parent /Count`, `/Dest [ref /XYZ null top null]` or `/Fit`). Copy metadata from `opts.meta`.
Tests (`tests/unit/writer.test.ts`, verify outputs by re-opening with pdf.js legacy and with pdf-lib):
- reorder `simple.pdf` to [3,1,2] → texts in that order.
- delete page 2 of `long300.pdf` → 299 pages; zero page objects outside the page tree.
- merge `simple.pdf` + `mixed.pdf` + `한글 문서.pdf` → 8 pages, landscape and 200×200 sizes kept, Korean text extractable.
- `links.pdf` and `links-explicit.pdf`: move "Page C" to the front → link "Go to C" on the Contents page now targets output page 1; delete "Page B" → its link annotation is gone; zero orphan page objects.
- `outline.pdf` reorder → outline titles and targets match `remapOutline` output.
- `encrypted.pdf` with password → output opens without a password; without password → rejects with `PdfOpenError` kind `password`.
- duplicate page (same ref twice) → two independent pages.

**C3** `src/edit/document.ts`
```ts
export class EditableDocument implements PageSource {
  static async open(data: Uint8Array, opts?: { password?: string }): Promise<EditableDocument>;
  readonly numPages: number;  readonly sizes: PageSize[];       // derived, refreshed on change
  get pages(): Composition;   get primary(): PdfDocument;
  addSource(data: Uint8Array, opts?: { password?: string }): Promise<number>;   // returns src id
  sourceCount(src: number): number;                               // page count of a source
  apply(next: Composition): boolean;                              // false when samePages; pushes history
  undo(): boolean; redo(): boolean;
  readonly canUndo: boolean; readonly canRedo: boolean; readonly dirty: boolean;
  markSaved(): void;
  onChange(cb: (kind: 'structure' | 'sizes') => void): () => void;
  save(): Promise<Uint8Array>;                                    // writePdf with remapped outline + primary metadata
  loadSizes(onBatch?: () => void): Promise<void>;                 // all sources, emits 'sizes'
  destroy(): Promise<void>;
  // PageSource members map through the composition
}
```
Tests: open/apply/undo through the public API using fixtures under Node; `save()` round-trip.

**C4** native side:
- `write_file(request: tauri::ipc::Request)`: raw body bytes, header `x-path` (URI-encoded UTF-8), atomic write (`<name>.preview-tmp` in the same directory, then `std::fs::rename`), error text surfaced to the UI.
- `clipboard_write_pdf(request)`: raw body → `%TEMP%\Preview Clipboard\Pages <yyyyMMdd-HHmmss>.pdf`, set `FileList`, remember `seq_num()` in app state; `clipboard_read_pdf_paths() -> Option<Vec<String>>`: `None` when the sequence number equals the remembered one, else the `.pdf` entries of the clipboard file list (empty vec when none).
- `open_window(path: String)`: spawn `current_exe()` with the path.
- Mica: in `setup`, if the Windows build is ≥ 22000 apply `Effect::Mica` to the main window and record `"mica"`; command `window_material() -> String`. Window config: `decorations: false`, `transparent: true`, `shadow: true`, remove `backgroundColor`.
- Capabilities: `core:window:allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-destroy`, `allow-is-maximized`, `allow-start-dragging`, `dialog:allow-save`, `dialog:allow-open`.
- Fill the Tauri platform stubs; `windowControls` via `getCurrentWindow()`; `onCloseRequested` via `getCurrentWindow().onCloseRequested` (prevent, await callback, `destroy()` when true).
- Verify: `scripts/build-windows.sh`, `cargo fmt --check`.

### Task D1–D7 (worktree `page-editing`, coordinator; after A, B, C merge)

- **D1** Viewer, thumbnails, find bar and outline consume `PageSource`. `PdfViewer.structureChanged()` re-lays out and reuses mounted page elements whose `pageKey` matches; thumbnails rebuild their list reusing rendered canvases by `pageKey`; find re-indexes; outline tab reads `getOutline()`. Test: delete 5 pages of `long300.pdf` at page 150 → ≤10 mounted pages, the page that was 156 is now 151 and was not re-rendered (canvas element identity kept).
- **D2** Selection in the sidebar using `Selection`; focusable list (`tabIndex=0`), accent vs gray selection, arrows/Shift+arrows, scroll-driven selection follows `currentPage` only while ≤1 page is selected.
- **D3** Pointer-driven drag reorder: 4px threshold, ghost from rendered thumbnail canvases, insertion gap from pointer y against thumbnail midpoints, auto-scroll within 40px of edges, Esc cancels, drop → `movePages` → `apply`. Tests for front, end, inside-own-selection no-op, multi-select non-contiguous.
- **D4** Context menu on thumbnails (Cut, Copy, Paste, Delete, Select All, Insert Pages from File…) and shortcuts; internal clipboard of `{src,index}` refs plus `clipboardWritePdf` of a PDF built from them; paste from internal refs, or from `clipboardReadPdfPaths()` files via `addSource`.
- **D5** Merge: Tauri/HTML5 file drops whose point lies over the thumbnail list insert at the gap under the point (insertion line shown during `onDragState`); drops elsewhere follow Task 0 rules; ⋯ menu "Insert Pages from File…" inserts after the selection; password-protected files prompt via `showAlert` with a password input (retry on wrong password, cancel skips the file).
- **D6** Save / Save As / dirty: `store.dirty` mirrors `doc.dirty`; title " — Edited"; Ctrl+S writes `doc.save()` to `filePath` (or Save As when the document came from a blob/drop without a real path); Save As uses `saveFileDialog` with `<name> copy.pdf`… default `<name>.pdf`, then the window's `filePath` and title switch to the new file; Ctrl+W/close/replacing the document with unsaved edits → `showAlert` "Do you want to save the changes made to the document “<name>”?" buttons Save (primary) / Don't Save / Cancel. Per-file state saving keys by the new path after Save As.
- **D7** ⋯ menu complete (Open…, Save, Save As…, Insert Pages from File…, Undo, Redo with disabled states). E2E suites `editing.spec.ts`, `merge.spec.ts`, `save.spec.ts` covering every Review Focus item through the browser shim; saved bytes are read back from `__pfwFiles` and re-opened.

### Task E: Verification and handoff

- [x] `npm test`, `npm run e2e`, `cargo fmt --check`, `scripts/build-windows.sh --bundle`.
- [x] Windows smoke: launch with `long300.pdf`, capture light screenshot of the new chrome with Mica; launch with `한글 문서.pdf`.
- [x] Fresh-context code review of the whole range; fix Critical/Important findings.
- [x] README (features, shortcuts), notes file, screenshots; update memory.
