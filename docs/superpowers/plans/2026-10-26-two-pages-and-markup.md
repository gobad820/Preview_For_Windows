# Two-page View and Markup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Preview's Two Pages layout and its Markup tools (highlight, underline, strikethrough, shapes, lines and arrows, freehand, text boxes, notes) with undo, saving as standard PDF annotations, and re-editing after reopening.

**Architecture:** Annotations are immutable data attached to `PageRef`s in the composition, so the existing undo history, dirty tracking and page operations carry them. A per-page overlay draws and edits them over the pdf.js canvas; pdf.js is told (`noView` in its annotation storage) to skip this app's own annotations once they are read from the file. The writer emits standard annotation dictionaries with appearance streams and a private `/PFW` JSON copy of the model. The layout gains rows so a row can hold two pages.

**Tech Stack:** as v0.2 (Tauri 2, pdfjs-dist 6.4.299, @cantoo/pdf-lib 2.11.1, TypeScript, Vitest, Playwright) plus `@pdf-lib/fontkit@1.1.1` (font subsetting) and, for verification only, `pypdfium2` 5.14 (PDFium 156) in the `pdftools` conda env.

**Spec:** `docs/superpowers/specs/2026-10-26-two-pages-and-markup-design.md` (builds on the two earlier specs and plans in `docs/superpowers/`).

## Global Constraints

- Everything in the v0.2 plan's Global Constraints still holds (shortcuts, no in-page HTML5 drag-and-drop, `PageRef.id` never reused, English UI strings, own `PW_PORT` per worktree and never 4173, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Geometry in the model is PDF user space of the source page (points, y up, unrotated); conversion only through the page's pdf.js `PageViewport` (`convertToPdfPoint` / `convertToViewportPoint` / `transform`).
- Colors are `#rrggbb` strings; widths and font sizes are points.
- An annotation is ours only when its dict has `/PFW` (JSON string of the model) and its `/AP /N` stream dict has `/PFWAnnot true`.
- Opening a file whose bytes do not contain `/PFWAnnot` must not run pdf-lib.
- Drawing, moving or restyling an annotation must not re-render the page canvas.
- Main toolbar order: sidebar button, View-menu chevron, title block, flexible space, highlight split button, markup button, zoom segmented control, zoom pill, rotate, ⋯, search, caption buttons.
- Shortcuts added: Ctrl+Shift+A markup toolbar, Ctrl+D duplicate annotation, Delete/Backspace delete the selected annotation (outside the sidebar), Esc ends editing / disarms a tool / deselects before it closes find.
- Text font: Malgun Gothic (`C:\Windows\Fonts\malgun.ttf`) embedded as a subset; without it Helvetica for WinAnsi text, otherwise no appearance stream.

## Review Focus

1. A text selection that runs from one page into the next (also from the left into the right page of a Two Pages row) marks exactly the selected lines on each page, one annotation per page, as one undo step. Test in Task B4.
2. On a page with `/Rotate 90`, and with the view rotated by Ctrl+L, a shape lands where it was drawn and a text box reads upright on screen; after saving, PDFium draws both in the same place. Tests in Tasks B3 and C2.
3. Open → edit → save → reopen → save again never duplicates or drops our annotations, and keeps foreign ones byte-for-byte equivalent (same subtype, rect, contents). Tests in Tasks C2 and C4.
4. Undoing a move, resize, restyle or text edit is one step back to the previous state, and undoing back to the saved state clears "— Edited". Test in Task B5.
5. Pages copied into another window (system clipboard) or merged from a file saved by this app arrive with editable annotations. Test in Task C4.

---

## File Structure (new or substantially changed)

```
src/annot/types.ts          — annotation model types                          (Task 0.1)
src/annot/geometry.ts       — bounds, translate, resize, hit test              (Task 0.1)
src/edit/composition.ts     — PageRef.annots, samePages, insertPages(annots)   (Task 0.2)
src/edit/document.ts        — annotation API, change kinds                     (Task 0.2, C4)
src/edit/editor.ts          — clipboard specs carry annots                     (Task 0.2)
src/viewer/viewer.ts        — PageView events, generation in render key        (Task 0.3, A2)
src/sidebar/thumbnails.ts   — PageView events for thumbnails                   (Task 0.3)
src/pdf/renderer.ts         — AnnotationMode.ENABLE_STORAGE                    (Task 0.3)
src/toolbar/toolbar.ts      — highlight split button, markup button, View chevron (Task 0.3, B1)
src/store.ts                — markupOpen, displayMode, bookMode                (Task 0.3)
src/viewer/layout.ts        — rows, spreads, fit, navigation                   (Task A1)
src/state/prefs.ts          — window-wide view preference                      (Task A3)
src/markup/state.ts         — tool, styles, defaults (persisted)               (Task B1)
src/markup/bar.ts           — markup toolbar row                               (Task B1)
src/markup/overlay.ts       — draws annotations for a PageView                 (Task B2)
src/markup/controller.ts    — tools, selection, commands                       (Tasks B3–B5)
src/markup/textMarkup.ts    — selection → per-page quads                       (Task B4)
src/annot/appearance.ts     — model → appearance stream content + /Rect        (Task C1)
src/annot/pdfWrite.ts       — annotation dicts into an output page             (Task C2)
src/annot/reader.ts         — marker scan, own annotations from a file         (Task C3)
src/edit/writer.ts          — calls pdfWrite for pages with annots             (Task C2)
src/platform/*.ts           — loadAnnotationFont()                             (Task C4)
scripts/make-fixtures.py    — rotated.pdf (page /Rotate 90), annotated.pdf (foreign annots) (Task C1)
scripts/pdfium-render.py    — renders a PDF page with PDFium to PNG for comparisons (Task C2)
tests/unit/{geometry,annotations,layout,markupState,textMarkup,appearance,annotWriter,annotReader}.test.ts
tests/e2e/{two-pages,markup-tools,markup-text,markup-edit,markup-save}.spec.ts
```

---

## Phase 0 — contracts on main (before branching)

### Task 0.1: Annotation model and geometry

**Files:** Create `src/annot/types.ts`, `src/annot/geometry.ts`; Test `tests/unit/geometry.test.ts`

**Interfaces (produced):**

```ts
// src/annot/types.ts
export type Color = string; // '#rrggbb'
export interface PdfPoint { readonly x: number; readonly y: number }
/** Normalized: x0 <= x1, y0 <= y1. */
export interface PdfRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
/** /QuadPoints order: top-left, top-right, bottom-left, bottom-right (x, y pairs). */
export type Quad = readonly [number, number, number, number, number, number, number, number];
/** Counter-clockwise degrees from page user space to "upright on screen" at creation. */
export type TextAngle = 0 | 90 | 180 | 270;
interface Base { readonly id: string; readonly color: Color; readonly opacity: number; readonly modified: string }
export interface MarkupAnnot extends Base { readonly kind: 'highlight' | 'underline' | 'strikeout'; readonly quads: readonly Quad[]; readonly text: string }
export interface ShapeAnnot extends Base { readonly kind: 'rect' | 'oval'; readonly rect: PdfRect; readonly fill: Color | null; readonly width: number; readonly rounded: boolean }
export interface LineAnnot extends Base { readonly kind: 'line' | 'arrow'; readonly from: PdfPoint; readonly to: PdfPoint; readonly width: number }
export interface InkAnnot extends Base { readonly kind: 'ink'; readonly paths: readonly (readonly PdfPoint[])[]; readonly width: number }
export interface TextBoxAnnot extends Base { readonly kind: 'text'; readonly rect: PdfRect; readonly text: string; readonly fontSize: number; readonly fill: Color | null; readonly border: Color | null; readonly borderWidth: number; readonly angle: TextAngle }
export interface NoteAnnot extends Base { readonly kind: 'note'; readonly rect: PdfRect; readonly text: string; readonly angle: TextAngle }
export type Annot = MarkupAnnot | ShapeAnnot | LineAnnot | InkAnnot | TextBoxAnnot | NoteAnnot;
export type AnnotKind = Annot['kind'];
export const NOTE_SIZE = 20; // points, side of the note icon box

// src/annot/geometry.ts
export function normRect(a: PdfPoint, b: PdfPoint): PdfRect;
/** Everything the annotation paints, incl. half the stroke width and arrowheads; the writer's /Rect. */
export function annotBounds(a: Annot): PdfRect;
export function translateAnnot<T extends Annot>(a: T, dx: number, dy: number): T;
/** Maps the annotation's geometry from box `from` to box `to` (rect, oval, text, ink points, line ends). Markup and notes only translate. */
export function resizeAnnot<T extends Annot>(a: T, from: PdfRect, to: PdfRect): T;
/** True when `p` is on the annotation: inside filled shapes, text boxes, notes and markup quads; within `tol` points of strokes otherwise. */
export function hitTest(a: Annot, p: PdfPoint, tol: number): boolean;
```

- [ ] **Step 1: Write failing tests** in `tests/unit/geometry.test.ts`: `normRect({x:5,y:9},{x:1,y:2})` → `{x0:1,y0:2,x1:5,y1:9}`; a rect annot with width 4 has bounds grown by 2 on every side; an arrow from (0,0) to (100,0) width 2 has bounds whose y-extent covers the arrowhead (y0 < -2); translate keeps `id` and moves every quad/point; resizing an ink path from box (0,0,10,10) to (0,0,20,40) doubles x and quadruples y; `hitTest` on an unfilled rect is true on the edge within tol and false in the middle, true in the middle when filled; on a highlight true inside a quad, false outside.
- [ ] **Step 2: Run** `npx vitest run tests/unit/geometry.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the types and functions above. Arrowhead length = `max(6, 3 × width)` points at `to`, opening angle 30° each side; the writer and overlay use the same constants (`ARROW_LEN(width)`, `ARROW_ANGLE`) exported from `geometry.ts`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: annotation model and geometry`.

### Task 0.2: Annotations in the composition and document

**Files:** Modify `src/edit/composition.ts`, `src/edit/document.ts`, `src/edit/editor.ts`; Test `tests/unit/annotations.test.ts` (+ adjust `composition.test.ts`, `editable.test.ts` only where types changed)

**Interfaces (produced):**

```ts
// composition.ts
export interface PageRef { readonly id: number; readonly src: number; readonly index: number; readonly annots?: readonly Annot[] }
export function insertPages(c, gap, refs: ReadonlyArray<{ src: number; index: number; annots?: readonly Annot[] }>, nextId): { pages; ids };
// samePages: same ids, same order AND same `annots` identity per position
export function sameOrder(a: Composition, b: Composition): boolean; // ids and order only
export function setPageAnnots(c: Composition, changes: ReadonlyMap<number /* position */, readonly Annot[]>): Composition;

// document.ts
export type ChangeKind = 'structure' | 'sizes' | 'annotations';
onChange(cb: (kind: ChangeKind, positions?: readonly number[]) => void): () => void; // 'annotations' carries changed positions
/** The page's annotations of this app; null while the source file's own ones are not read yet. */
annotationsAt(index: number): readonly Annot[] | null;
/** Resolves with the page's annotations once known (the file's own ones read). */
loadAnnotations(index: number): Promise<readonly Annot[]>;
/** One undo step for any number of pages; false (no history entry) when nothing changed. */
updateAnnotations(changes: ReadonlyMap<number, readonly Annot[]>): boolean;
setAnnotations(index: number, list: readonly Annot[]): boolean; // = updateAnnotations of one page
/** Bumps when the canvas must be re-rendered because own annotations became hidden; part of render keys. */
hideGeneration(index: number): number;
newAnnotId(): string; // crypto.randomUUID()
```

- In this task `annotationsAt` returns `ref.annots ?? []` and `hideGeneration` returns 0; Task C4 adds reading from files.
- `undo`/`redo` emit `'annotations'` (with the positions whose `annots` differ) when `sameOrder(prev, next)`, else `'structure'`.
- `Editor` clipboard specs and `extract` specs carry `annots` (a pasted copy shares the immutable arrays, which is safe).

- [ ] **Step 1: Write failing tests** in `tests/unit/annotations.test.ts`: `setAnnotations(0, [a])` makes `dirty` true, emits `('annotations', [0])` and is undone by one `undo()` that emits `('annotations', [0])`; setting the same array again returns false and adds no history entry; moving page 0 to the end keeps its annotations (`annotationsAt(last)` is `[a]`); deleting it and undoing restores them; `updateAnnotations` over pages 0 and 1 is a single undo step; `samePages` is false when only `annots` differ and `sameOrder` is true.
- [ ] **Step 2: Run** `npx vitest run tests/unit/annotations.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above; `App.onDocChange` handles `'annotations'` by updating `dirty` only (the viewer part comes in Task 0.3).
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS (all 330+ existing tests too).
- [ ] **Step 5: Commit** `feat: annotations travel with pages in the composition`.

### Task 0.3: View events, render generation, toolbar and store contracts

**Files:** Modify `src/viewer/viewer.ts`, `src/sidebar/thumbnails.ts`, `src/pdf/renderer.ts`, `src/pdf/source.ts`, `src/toolbar/toolbar.ts`, `src/ui/icons.ts`, `src/store.ts`, `src/app.ts`, `index.html`, `src/styles.css`; Test `tests/e2e/contracts.spec.ts`

**Interfaces (produced):**

```ts
// src/pdf/source.ts — PageSource gains
hideGeneration?(index: number): number;

// src/viewer/viewer.ts (and the same two methods on ThumbnailList)
export interface PageView {
  readonly index: number;            // current position
  readonly el: HTMLElement;          // element an overlay appends to and fills (position: relative)
  readonly viewport: PageViewport;   // pdf.js viewport in CSS px (scale × CSS_UNITS, page.rotate + view rotation)
  readonly canvasGeneration: number; // hideGeneration the visible canvas was rendered with; -1 before the first render
  readonly interactive: boolean;     // true in the document view, false for thumbnails
}
onPageView(cb: (view: PageView) => void): () => void; // after mount, after each canvas swap, after scale/rotation/position change
onPageGone(cb: (el: HTMLElement) => void): () => void; // element unmounted or recycled away
annotationsChanged(): void; // re-render mounted canvases whose hideGeneration changed

// store.ts — ViewerState gains
markupOpen: boolean;                          // initial false
displayMode: 'continuous' | 'two-pages';      // initial 'continuous'
bookMode: boolean;                            // initial false

// toolbar.ts — ToolbarActions gains
toggleMarkup(): void; highlight(): void; highlightMenu(anchor: DOMRect): void; viewMenu(anchor: DOMRect): void;
// buttons: [data-action="view-menu"] (chevron after the sidebar button), [data-action="highlight"] + [data-action="highlight-menu"] (one split control), [data-action="markup"] (aria-pressed follows markupOpen)
// toolbar.setHighlight(state: { on: boolean; color: Color; kind: 'highlight' | 'underline' | 'strikeout' }): void — swatch under the marker icon
```

- `index.html` gets `<div id="markupbar" class="markupbar" hidden></div>` right after `<header id="toolbar">`; the app shows it while `markupOpen`.
- The renderer always renders with `annotationMode: AnnotationMode.ENABLE_STORAGE` (identical output while the storage is empty); render keys include `hideGeneration(index)`.
- Thumbnail canvases sit inside `span.thumb-canvas` (position: relative) which is the thumbnail `PageView.el`.
- App stubs: `toggleMarkup` flips `markupOpen`; `highlight`, `highlightMenu`, `viewMenu` do nothing yet.

- [ ] **Step 1: Write failing e2e test** `tests/e2e/contracts.spec.ts`: after opening `simple.pdf`, `window.__pfw.viewer.onPageView` has delivered a view for page 0 whose `viewport.width` equals the page element's CSS width and whose `canvasGeneration` is 0 after the first render; the toolbar has the four new buttons in the order of the Global Constraints; clicking the markup button shows `#markupbar` and sets `aria-pressed="true"`.
- [ ] **Step 2: Run** `PW_PORT=4301 npx playwright test tests/e2e/contracts.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above; icons `markup` (pen tip in a circle), `highlighter` (marker), `viewMenu` uses `chevronDown`.
- [ ] **Step 4: Run** `npx vitest run && PW_PORT=4301 npx playwright test` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat: page view events, render generation and markup/view toolbar contracts`, then create the three Orca worktrees from this commit.

---

## Branch `two-page-view` (agent)

### Task A1: Rows in the pure layout

**Files:** Modify `src/viewer/layout.ts`; Test `tests/unit/layout.test.ts`

**Interfaces (produced):**

```ts
export type Spread = 'none' | 'pairs' | 'book';
export interface LayoutOptions { scale; rotation; gap; padding; containerWidth; spread: Spread; spineGap: number }
export interface RowRect { top: number; height: number; first: number; last: number }
export interface Layout { pages: PageRect[]; rows: RowRect[]; totalHeight: number; contentWidth: number; padding: number }
export function rowOfPage(layout: Layout, index: number): number;
export function fitWidthScale(sizes, rotation, containerWidth, padding, spread: Spread, spineGap: number): number;
export function fitPageScale(sizes, rotation, containerWidth, containerHeight, padding, spread: Spread, spineGap: number): number;
/** First page of the row after (dir 1) or before (dir -1) the row holding `index`; clamped. */
export function stepRow(layout: Layout, index: number, dir: 1 | -1): number;
```

- `visibleRange`, `currentPageIndex`, `scrollTopForPage`, `docPointAt`, `yForDocPoint`, `anchoredScrollTop` search rows (binary search on row tops), so page tops need not be monotonic. `currentPageIndex` returns the page with the largest visible area, the left one on ties.
- Pairs: rows [0,1],[2,3],…; book: [0] alone on the right, then [1,2],[3,4],…; a lone last page in pairs sits on the left. Pages are centered vertically in their row; left page right-aligned to the spine, right page left-aligned; the spine is the content's horizontal center.

- [ ] **Step 1: Write failing tests**: with four 600×800 pages, `spread:'pairs'`, scale 1, gap 16, spineGap 8: two rows; `pages[1].left - (pages[0].left + pages[0].width) === 8`; `rowOfPage(layout, 3) === 1`; `stepRow(layout, 0, 1) === 2`; `book` makes row 0 hold only page 0 with `pages[0].left` ≥ the spine; pages of different heights in one row share a center; `fitWidthScale` for pairs is half of single for equal pages (minus the spine gap); `currentPageIndex` with both pages fully visible returns the left one; all existing single-column tests still pass with `spread:'none'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/layout.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: two-page rows in the layout`.

### Task A2: Viewer and navigation in Two Pages

**Files:** Modify `src/viewer/viewer.ts`, `src/app.ts`, `src/search/findbar.ts` (only if it computes positions itself); Test `tests/e2e/two-pages.spec.ts`

**Interfaces:** Consumes Task A1 and the store's `displayMode`/`bookMode`. Produces `PdfViewer.setDisplay(mode: 'continuous' | 'two-pages', book: boolean): void` (keeps the viewport's center page in view) and `PdfViewer.stepPage(dir: 1 | -1): void`.

- The `onPageView`/`onPageGone` events from Task 0.3 keep firing exactly as before (overlays depend on them). Spine gap 8 px (*builder may tune*).
- `next-page`/`prev-page` call `stepPage`; the toolbar page field and Go to Page scroll to the row of the page.

- [ ] **Step 1: Write failing e2e tests**: opening `mixed.pdf` and setting `displayMode:'two-pages'` puts pages 1 and 2 side by side (same row: their vertical centers within 1 px, page 2 to the right); → moves the page indicator from 1 to 3; Fit Width makes the row fill the width minus padding; book mode shows page 1 alone; rotating and zooming at the cursor keep working (page under the cursor stays under it within 2 px); on `long300.pdf` at most 12 page canvases are mounted while scrolling in two-page mode.
- [ ] **Step 2: Run** `PW_PORT=4311 npx playwright test tests/e2e/two-pages.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && PW_PORT=4311 npx playwright test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Two Pages layout in the viewer with spread navigation`.

### Task A3: View menu and remembered preference

**Files:** Create `src/state/prefs.ts`; Modify `src/app.ts`, `src/toolbar/toolbar.ts`; Test `tests/unit/prefs.test.ts`, `tests/e2e/two-pages.spec.ts`

**Interfaces:** Produces `loadPrefs(): { displayMode: 'continuous' | 'two-pages'; bookMode: boolean }` and `savePrefs(p): void` (localStorage key `pfw.view`, try/catch, defaults on garbage).

- The `[data-action="view-menu"]` chevron opens a Mac menu: Hide Sidebar / Show Sidebar (Ctrl+Alt+S), Thumbnails (radio), Table of Contents (radio), separator, Continuous Scroll (radio), Two Pages (radio), Book Mode (checkbox, disabled unless Two Pages).

- [ ] **Step 1: Write failing tests**: prefs round-trip and garbage → defaults; e2e: choosing Two Pages from the View menu switches the layout and survives a reload; Book Mode is disabled in Continuous Scroll; choosing Table of Contents opens the sidebar on that tab.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat: View menu with Two Pages and Book Mode`.

---

## Branch `markup-ui` (agent)

Works against Phase 0 only: annotations live in memory (`annotationsAt` never returns null before Task C4 lands, but the UI must handle null: draw nothing for that page and `await loadAnnotations` before editing it).

### Task B1: Markup state, markup bar, toolbar buttons, shortcuts

**Files:** Create `src/markup/state.ts`, `src/markup/bar.ts`; Modify `src/toolbar/toolbar.ts`, `src/ui/icons.ts`, `src/shortcuts.ts`, `src/app.ts`, `src/styles.css`; Test `tests/unit/markupState.test.ts`, `tests/unit/shortcuts.test.ts`

**Interfaces (produced):**

```ts
export type Tool = 'select' | 'draw' | 'line' | 'arrow' | 'rect' | 'rounded' | 'oval' | 'text' | 'note';
export type MarkKind = 'highlight' | 'underline' | 'strikeout';
export interface Styles { stroke: Color; fill: Color | null; width: number; textColor: Color; fontSize: number; markColor: Color; markKind: MarkKind }
export class MarkupState {
  readonly tool: Tool; readonly highlightMode: boolean; readonly styles: Styles;
  setTool(t: Tool): void; setHighlightMode(on: boolean): void; setMark(kind: MarkKind, color?: Color): void;
  setStyles(patch: Partial<Styles>): void;   // persists to localStorage 'pfw.markup'
  onChange(cb: () => void): () => void;
}
// shortcuts.ts Action gains 'toggle-markup' (Ctrl+Shift+A), 'duplicate-annotation' (Ctrl+D, not in text fields), 'delete-annotation' (Delete/Backspace outside sidebar and text fields)
```

- Default styles (*builder may tune the exact hues*): stroke `#ff3b30`, fill null, width 2, textColor `#000000`, fontSize 12, highlight yellow; underline and strikethrough default to red; marks use opacity 1 drawn with multiply blending.
- Markup bar content and order per the spec; tool buttons show pressed state; Draw is a toggle, shapes come from one Shapes menu button.

- [ ] **Step 1: Write failing tests**: styles persist and reload; garbage storage → defaults; `setMark('underline')` keeps the highlight color separate from the underline color; Ctrl+Shift+A resolves to `toggle-markup` (also with an IME key and `code: 'KeyA'`), Ctrl+D to `duplicate-annotation` outside text fields only, Delete in the document view to `delete-annotation` but in the sidebar still to `delete-pages`.
- [ ] **Step 2–4:** run (FAIL), implement, run all tests (PASS).
- [ ] **Step 5: Commit** `feat: markup state, markup toolbar and shortcuts`.

### Task B2: Overlay drawing for document pages and thumbnails

**Files:** Create `src/markup/overlay.ts`; Modify `src/app.ts`, `src/styles.css`; Test `tests/e2e/markup-tools.spec.ts`

**Interfaces (produced):** `class PageOverlay { constructor(view: PageView); update(view: PageView, annots: readonly Annot[] | null, selected: string | null): void; destroy(): void }`; one per `PageView.el`, created on `onPageView`, destroyed on `onPageGone`.

- SVG layer with `transform` = viewport transform, so model coordinates are used directly; text boxes and notes are HTML positioned from `viewport.convertToViewportPoint` and rotated by `(viewport.rotation − angle)`; highlights use `mix-blend-mode: multiply`. The overlay draws nothing when `annots` is null or `view.canvasGeneration !== doc.hideGeneration(view.index)`.
- Text box font stack: `"Malgun Gothic", "Apple SD Gothic Neo", sans-serif`; line height 1.2; padding 2 pt.

- [ ] **Step 1: Write failing e2e test**: seed one annotation of every kind on page 1 via `__pfw.app.document.setAnnotations`; the overlay has one element per annotation positioned within 1 px of `viewport.convertToViewportPoint` of its bounds; the same in the page's thumbnail; zooming and rotating move them with the page without re-rendering the canvas (`canvas` element identity unchanged after a style-only change).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat: draw annotations over pages and thumbnails`.

### Task B3: Creation tools

**Files:** Create `src/markup/controller.ts`; Modify `src/app.ts`; Test `tests/e2e/markup-tools.spec.ts`

**Interfaces (produced):** `class MarkupController { constructor(deps: { doc(): EditableDocument | null; viewer: PdfViewer; state: MarkupState; store: Store<ViewerState> }); handleEscape(): boolean; deleteSelected(): boolean; duplicateSelected(): boolean; readonly selected: { pageId: number; annotId: string } | null }`

- Shapes: drag creates at the dragged size, click creates 100×70 pt (lines 100 pt) centered on the click, Shift constrains; then tool → `select` and the new annotation is selected. Draw stays armed; each stroke one ink annotation (points thinned to ≥ 1 pt apart). Text: creates a box and starts editing with "Text" selected; empty after editing → removed (no history entry). Note: places a `NOTE_SIZE` icon and opens its popup; empty → removed. New text boxes and notes store `angle` so they are upright on screen.
- While a tool other than `select` is armed, the overlay captures pointer events (crosshair cursor) and the text layer is not selectable.

- [ ] **Step 1: Write failing e2e tests** (real mouse via `page.mouse`): dragging with Rectangle creates one `rect` whose model rect maps back to the drag box within 1 pt; Shift+drag with Oval gives equal width and height; a click with Arrow creates a 100 pt arrow; three strokes with Draw make three `ink` annots and Esc disarms; Text → type "안녕 Hello" → click outside stores that text; on `rotated.pdf` (after C1's fixture lands use it, until then rotate the view with Ctrl+L) the rectangle stays where it was dragged and a new text box's `angle` makes it upright on screen.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat: shape, line, drawing, text and note tools`.

### Task B4: Highlight, underline and strikethrough from the text selection

**Files:** Create `src/markup/textMarkup.ts`; Modify `src/markup/controller.ts`, `src/toolbar/toolbar.ts`, `src/app.ts`; Test `tests/unit/textMarkup.test.ts`, `tests/e2e/markup-text.spec.ts`

**Interfaces (produced):** `quadsForRects(rects: PdfRect[]): Quad[]` (pure: merges rects that overlap vertically by ≥ 50% of the smaller height and touch or overlap horizontally within 2 pt, then emits one quad per merged rect); `selectionToMarks(sel: Selection, views: PageView[]): Map<number /* position */, { quads: Quad[]; text: string }>`.

- [ ] **Step 1: Write failing tests**: `quadsForRects` merges word rects on one line into one quad and keeps two lines as two quads; e2e: with highlight mode on, selecting a sentence on page 1 creates one `highlight` with one quad per line and clears the selection; selecting from the end of page 1 into page 2 creates one annotation on each page in a single undo step (Review Focus 1), also in Two Pages layout after the merge with `two-page-view`; with highlight mode off, selecting text then clicking the highlight button marks it and turns the mode on; choosing Strikethrough from the chevron menu then selecting creates a `strikeout`; plain text selection and Ctrl+C still copy text when highlight mode is off.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat: highlight, underline and strikethrough selected text`.

### Task B5: Select, move, resize, restyle, delete, duplicate, undo grouping

**Files:** Modify `src/markup/controller.ts`, `src/markup/overlay.ts`, `src/markup/bar.ts`, `src/app.ts`; Test `tests/e2e/markup-edit.spec.ts`

- Click selects (topmost hit by `hitTest` with tol 4 CSS px converted to points); handles per the spec; Shift keeps proportions; arrows nudge 1 pt (Shift 10 pt) and do not change pages while something is selected; style controls apply to the selection and set defaults; right-click menu Delete / Duplicate / Edit Text; Ctrl+D offsets the copy by 10 pt right and down; one undo step per move, resize, restyle or text editing session.

- [ ] **Step 1: Write failing e2e tests**: drag a selected rectangle by 50 px → one history entry, model moved by 50 px in points; resize from the bottom-right handle; Delete removes, Ctrl+Z restores, Ctrl+Y removes again; undo back to the opened state clears "— Edited" (Review Focus 4); changing Border Color while a line is selected recolors it and the next line uses that color; a click on highlighted text selects the highlight, a drag from it selects text; the selection survives moving its page in the sidebar.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat: select, move, resize, restyle, delete and duplicate annotations`.

---

## Branch `annot-core` (me)

### Task C1: Appearance streams and fixtures

**Files:** Create `src/annot/appearance.ts`; Modify `scripts/make-fixtures.py`, `tests/fixtures/` (`rotated.pdf`, `annotated.pdf`); Test `tests/unit/appearance.test.ts`

**Interfaces (produced):** `buildAppearance(a: Annot, font: AppearanceFont | null): { rect: PdfRect; bbox: PdfRect; matrix?: [number, number, number, number, number, number]; content: string; extGState?: { CA: number; BM?: 'Multiply' }; usesFont: boolean } | null` and `interface AppearanceFont { name: string; encode(text: string): string /* hex string operand */; widthOf(text: string, size: number): number; ascent: number; descent: number }`. `null` only for a text box whose text the font cannot encode.

- `fixtures`: `rotated.pdf` (page 1 `/Rotate 90` with text), `annotated.pdf` (a foreign Acrobat-style `/Highlight` with its own appearance and a `/Text` note with a `/Popup`).
- [ ] **Step 1–5:** tests: highlight content fills each quad with `/GS0 gs` multiply; underline stroke sits at 1/14 of the quad height above its bottom; arrow content contains the head path; text box wraps "a b c …" to the box width using `widthOf`, and `angle: 90` sets `matrix` to a 90° rotation about the box; `rect` equals `annotBounds`. Commit `feat: appearance streams for markup`.

### Task C2: Writing annotations

**Files:** Create `src/annot/pdfWrite.ts`, `scripts/pdfium-render.py`; Modify `src/edit/writer.ts`, `package.json` (`@pdf-lib/fontkit`); Test `tests/unit/annotWriter.test.ts`

**Interfaces (produced):** `writePdf(sources, pages: ReadonlyArray<{ src; index; annots?: readonly Annot[] }>, opts: WriteOptions & { font?: () => Promise<Uint8Array | null> })`.

- For a page with `annots`: own copied annotations matched by model id are rewritten in place (same object number; `/Popup`, `/StructParent`, `/OC` carried over), own ones no longer in the list are removed together with annotations whose `/Parent` or `/IRT` chain leads to them, new ones appended; foreign annotations untouched. Pages without `annots` are copied exactly as in v0.2.
- [ ] **Step 1–5:** tests parse the output with pdf-lib and pdf.js: every kind round-trips with `/Subtype`, `/Rect`, `/QuadPoints`/`/InkList`/`/L`/`/LE`, `/C`, `/IC`, `/BS /W`, `/CA`, `/Contents`, `/F 4`, `/NM`, `/PFW`, `/AP /N` with `/PFWAnnot`; saving twice yields the same number of annotations (Review Focus 3); a deleted own annotation's foreign reply is gone and nothing unreachable stays; `annotated.pdf`'s foreign annotations survive with their rect and contents; with `malgun.ttf` present (skip otherwise) a "안녕 Hello" box embeds a subset font under 200 KB; PDFium (`scripts/pdfium-render.py`) renders red pixels inside a saved rectangle's stroke on `rotated.pdf` at the dragged place (Review Focus 2). Commit `feat: write annotations with appearance streams`.

### Task C3: Reading our annotations back

**Files:** Create `src/annot/reader.ts`; Test `tests/unit/annotReader.test.ts`

**Interfaces (produced):** `hasOwnMarker(bytes: Uint8Array): boolean`; `readOwnAnnotations(bytes: Uint8Array, password?: string): Promise<Array<Array<{ annot: Annot; ref: string /* pdf.js id, e.g. "12R" */ }>>>` (one list per page, `/Annots` order; skips entries whose JSON fails validation or whose current `/AP /N` lacks `/PFWAnnot`).

- [ ] **Step 1–5:** tests: writer → reader round-trips every kind exactly (deep equal); `hasOwnMarker` false on all old fixtures; an annotation whose appearance was replaced (no marker) is skipped; invalid JSON is skipped; refs equal the ids pdf.js `getAnnotations()` reports. Commit `feat: read this app's annotations from a file`.

### Task C4: Document integration, fonts, round trips

**Files:** Modify `src/edit/document.ts`, `src/pdf/document.ts`, `src/platform/{types,browser,tauri}.ts`, `src/app.ts`; Test `tests/unit/editable.test.ts`, `tests/e2e/markup-save.spec.ts`

**Interfaces (produced):** `Platform.loadAnnotationFont(): Promise<Uint8Array | null>` (Tauri: `C:\Windows\Fonts\malgun.ttf`; browser: `window.__pfwAnnotFont ?? null`); `PdfDocument.hideAnnotations(ids: string[]): void` (sets `noView` in pdf.js storage).

- Sources whose bytes contain the marker are read after the first paint (`readOwnAnnotations`), then their ids hidden, their `hideGeneration` bumped and `'annotations'` emitted for the positions using them; `loadAnnotations` waits for that. `save()` and `extract()` pass each page's `annots` (unedited pages: `undefined`).
- [ ] **Step 1–5:** tests: opening `simple.pdf` never calls the reader (spy); open → add → save → reopen gives editable equal annotations and the canvas no longer contains them (pixel check at a highlight); extracting pages with annotations and adding the result as a new source yields the same annotations (Review Focus 5); merge a saved annotated file → editable; e2e through the UI after the merge with `markup-ui`. Commit `feat: reopen, merge and paste keep annotations editable`.

---

## Integration (me, on main)

- [ ] Merge `two-page-view` (`--no-ff`), then `annot-core`, then `markup-ui`; resolve `app.ts`/`toolbar.ts`/`styles.css` conflicts; run `npx vitest run`, `PW_PORT=4320 npx playwright test`, `cargo fmt --check`.
- [ ] End-to-end e2e `tests/e2e/markup-roundtrip.spec.ts`: in Two Pages, highlight across the spread, draw a rectangle and an arrow, type a Korean text box, add a note, save, reopen, all five editable; PDFium render of the saved file shows them.
- [ ] Fresh-context code review of `main..` (all three branches), fix findings with tests.
- [ ] Windows build (`scripts/build-windows.sh --bundle`), version 0.3.0, real-Windows CDP run: create every kind through the UI, save, check the file with pypdf and PDFium, reopen and edit; copy to `C:\Users\Public\pfw-smoke\Preview 0.3.exe`.
- [ ] README (features, shortcuts, "Not in scope" update), notes file `docs/superpowers/plans/2026-10-26-two-pages-and-markup-notes.md`, memory update.
