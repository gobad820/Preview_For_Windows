# Two-page view and markup — design

Date: 2026-10-26
Status: approved by goal directive (`/goal`), autonomous build; every "my call" below
is a decision the user did not make and can overturn
Builds on: `2026-10-26-pdf-viewer-design.md` (v0.1 viewer) and
`2026-10-26-page-editing-and-mac-ui-design.md` (v0.2 page editing, Mac chrome)

## Intent

The user's words: "이제 양쪽 보기랑 그 도형 넣기, 밑줄, 취소선, 형광펜. 등등 editing 기능만
지금 상황에서 추가하면 끝날듯" — now add a two-page view and the editing features
(inserting shapes, underline, strikethrough, highlighter, and so on), and the app is done.

"Preview" means macOS Preview. After v0.2 the app reads and rearranges PDFs like
Preview; what is missing is what most people use Preview for next: marking up a
document. In Preview that is the Markup toolbar (highlight, underline, strike
through, shapes, freehand drawing, text boxes, notes) plus the View menu's
"Two Pages" layout for reading spreads. Success is that a user can open a paper,
read it two pages at a time, highlight and underline passages, circle a figure,
draw an arrow, type a comment, save, and see exactly those marks in Acrobat,
Edge/Chrome or Mac Preview, and later reopen the file in this app and keep
editing those marks.

## Goals

### Two-page view

- The view can show pages one per row (today's **Continuous Scroll**) or two per
  row (**Two Pages**), still scrolling continuously. Rows of two are centered
  with the pages meeting at a narrow gap, like an open book.
- **Book Mode** (only meaningful in Two Pages): the first page sits alone on the
  right, so later spreads pair 2–3, 4–5, … like a printed book. Off by default:
  spreads pair 1–2, 3–4, …
- Fit Width and Fit Page fit a whole row (both pages), not a single page.
- Page navigation follows spreads: → / ← and the toolbar page field move one
  row; the page indicator shows the left page of the row that is most visible.
  Thumbnails, find, outline jumps, zoom-at-cursor, rotation, page editing and
  markup all keep working in both modes.
- The choice lives in a **View menu**: a chevron next to the sidebar button
  opens it (Mac Preview keeps these under View), with Hide/Show Sidebar,
  Thumbnails, Table of Contents, then Continuous Scroll / Two Pages (radio) and
  Book Mode (checkbox, enabled only in Two Pages). *My call:* the layout is a
  window-wide preference remembered across launches (not per file), and there are
  no keyboard shortcuts for it (Ctrl+1/Ctrl+2 are already zoom).

### Markup (annotations)

Annotations are added, selected, moved, resized, restyled, deleted, undone and
saved. Types:

| Tool | Result in the PDF | Notes |
| --- | --- | --- |
| Highlight (yellow, green, blue, pink, purple) | `/Highlight` | over selected text |
| Underline | `/Underline` | over selected text, red by default (Preview) |
| Strikethrough | `/StrikeOut` | over selected text, red by default |
| Rectangle, Rounded Rectangle | `/Square` | stroke and optional fill |
| Oval | `/Circle` | stroke and optional fill |
| Line, Arrow | `/Line` (`/LE` for the arrowhead) | |
| Draw (pen) | `/Ink` | freehand, smoothed |
| Text | `/FreeText` | typed text in a box, Hangul included |
| Note | `/Text` (sticky note) | icon on the page, text in a popup |

- **Markup toolbar**: a markup button (pen-tip icon) in the main toolbar, and
  Ctrl+Shift+A, shows or hides a second toolbar row under the main one, in the
  same material, as in Preview. It holds, left to right: Text Selection, Draw,
  Shapes (menu: Line, Arrow, Rectangle, Rounded Rectangle, Oval), Text, Note,
  a separator, Highlight (split button, see below), a separator, then the style
  controls: Line Width, Border Color, Fill Color, Text Style (size and color).
- **Highlight button** in the main toolbar as well (Preview has it there), a
  split button: the main part toggles *highlight mode* with the current style;
  its chevron menu picks Yellow / Green / Blue / Pink / Purple / Underline /
  Strikethrough. In highlight mode, finishing a text selection immediately marks
  it with the current style and clears the selection. With highlight mode off,
  pressing the button while text is selected marks that selection and turns the
  mode on (Preview behaves this way).
- **Creating shapes**: picking Rectangle, Rounded Rectangle, Oval, Line or Arrow
  arms that tool once; dragging on a page creates the shape at the dragged size,
  a plain click creates a default-sized shape centered on the click. Shift
  constrains to a square/circle or to 45° lines. After one shape the tool goes
  back to Text Selection and the new shape is selected (Preview's one-shot
  behaviour). **Draw** stays active until turned off or Esc, so several strokes
  can be drawn; each stroke is its own annotation.
- **Text**: the Text tool creates a box where clicked (or dragged) and puts it in
  editing mode with placeholder "Text" selected; typing replaces it. The box
  grows downward as lines are added. Double-click a text box to edit it again;
  Esc or a click outside ends editing; an empty box is removed when editing ends.
- **Note**: the Note tool places a sticky-note icon where clicked and opens its
  popup editor; clicking the icon later opens the popup again; empty notes are
  removed when their popup closes.
- **Selecting**: in Text Selection mode, clicking an annotation selects it (a
  click on highlighted text selects that highlight; a drag starting on it still
  selects text). Selection shows handles: corner and edge handles for
  rectangles, ovals, text boxes and drawings; two endpoint handles for lines and
  arrows; no handles for text markup and notes. Drag to move, drag handles to
  resize (Shift keeps proportions), arrow keys nudge by 1 pt (Shift: 10 pt),
  Delete/Backspace deletes, Esc deselects, Ctrl+D duplicates (Preview's ⌘D).
  Right-click an annotation for a small menu: Delete, Duplicate, and Edit Text
  for text boxes and notes. One annotation is selected at a time (*my call*;
  Preview allows several).
- **Styles**: picking a color, fill, width or text style changes the selected
  annotation and becomes the default for new ones, remembered across launches
  (Preview's behaviour). Palettes are a small fixed set of Preview-like colors
  plus "No Fill"; widths 0.5, 1, 2, 3, 5, 8 pt; text sizes 9–72 pt; there is one
  font (*my call*: Malgun Gothic, which also covers Hangul; see Constraints).
- **Undo/Redo** (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) covers every markup change in the
  same history as page edits; markup changes mark the document "— Edited".
  A move or resize is one undo step, not one per mouse move; typing a text box
  is one step per editing session.
- **Pages carry their marks**: reordering, copying, cutting, pasting (in this
  window and into another window) and merging move annotations with their
  pages; deleting a page deletes its annotations; a pasted copy gets its own,
  independent copy of the annotations.
- **Thumbnails** show annotations, as Preview's do.
- **Saving**: annotations are written as standard PDF annotations with
  appearance streams, so every viewer draws them the same way (anti-goal below).
  Reopening a file saved by this app makes those annotations editable again,
  with the exact properties they had.
- **Annotations from other apps** (Acrobat comments, Preview markup, links, form
  widgets) keep being displayed as today and are kept unchanged on save. They are
  not editable in this release (non-goal).

## Non-goals

- Editing, recoloring or deleting annotations created by other applications.
- Signatures, loupe, mask, speech bubble, star, polygon, sketch-to-shape
  recognition, stamps and images, redaction, rich text, choosing a font family,
  dashed lines, shadows.
- A "Highlights and Notes" sidebar list.
- Copying annotations between windows (pages with their marks can be copied).
- Multiple selection of annotations, rubber-band selection, grouping.
- A non-continuous "Single Page" mode.
- Printing with annotations beyond what the webview's Ctrl+P already does.
- Form filling.

## Anti-goals

- **Marks only this app can see.** Every saved annotation must carry an
  appearance stream and the standard keys (`/Rect`, `/QuadPoints`, `/InkList`,
  `/L`, `/C`, `/IC`, `/BS`, `/CA`, `/Contents`, `/F` = Print), and look the same
  in Chrome/Edge (PDFium) and pdf.js as in this app.
- **Damaging what was already in the file.** Foreign annotations, links and the
  rest of v0.2's save guarantees (no leaked deleted pages, outline, metadata,
  atomic write) must hold; a file that contains none of this app's annotations
  and has no markup edits must be written exactly as v0.2 writes it.
- **A slower viewer.** Opening a PDF that contains none of this app's
  annotations must do no extra parsing; drawing, moving or restyling an
  annotation must not re-render the page canvas; two-page layout must be as
  smooth as one-page on the 300-page fixture.
- **Losing work.** Every markup change is undoable and counts as unsaved.
- **Fighting the text selection.** Selecting and copying text must keep working
  exactly as in v0.2 whenever no drawing tool is armed.

## Constraints

- Same toolchain and verification layers as before (WSL cross-build, Vitest,
  Playwright in the browser shim, real-Windows checks through
  `scripts/cdp-windows.ps1`); features built on separate branches in Orca
  worktrees, merged to main.
- Pointer events only (no HTML5 drag-and-drop) inside the page, as in v0.2.
- **Fonts**: a FreeText appearance needs an embedded font that covers what was
  typed, Hangul included. Malgun Gothic ships with every Windows 10/11 and its
  license flags allow editable embedding (OS/2 `fsType` = 8, checked on this
  machine). At save time the app reads `C:\Windows\Fonts\malgun.ttf` and embeds a
  subset with only the glyphs used. Without that font (browser tests, other
  OS), text that WinAnsi can encode falls back to Helvetica; for other text the
  appearance draws only the box (fill and border) and the text stays in
  `/Contents`, so the annotation keeps its marker and stays editable here
  (documented limitation: other viewers then show an empty box). *Changed during
  the build:* the first version omitted the appearance, which made such a box
  foreign, and so no longer editable, after reopening.

## How it gets made (decided)

### Two-page layout

- The pure layout (`src/viewer/layout.ts`) gains *rows*: each row has a top,
  a height and its pages; Continuous Scroll is rows of one. Visibility,
  current page, scroll anchoring and go-to-page work on rows, so page tops no
  longer have to be monotonic. Pages in a two-page row are vertically centered
  in the row; the left page is right-aligned to the spine and the right page
  left-aligned to it; a lone last page sits on the left, the Book Mode cover on
  the right.

### Annotation model

- An annotation is plain immutable data (`src/annot/types.ts`) with a stable id,
  a kind, colors as `#rrggbb`, opacity, width and geometry in the page's own PDF
  user space (unrotated, the space `/Rect` uses). The view converts with the
  page's pdf.js viewport, so view rotation, the page's `/Rotate` and zoom need no
  special cases in the model.
- Annotations live **in the composition**: `PageRef` gains
  `annots?: readonly Annot[]`. `undefined` means "this app's annotations as they
  are in the source file"; an array means the page's list was edited. Because
  the composition is already the undo history, markup undo, dirty tracking and
  "pages carry their marks" come for free; `samePages` also compares `annots`
  by identity, and a change that keeps ids and order is reported as an
  annotation change (only overlays update) instead of a structure change.
- **Own vs. foreign**: an annotation written by this app carries a private key
  `/PFW` holding its model as JSON, and its appearance stream dictionary carries
  `/PFWAnnot true`. Stream dictionaries are never inside compressed object
  streams, so a byte search for `/PFWAnnot` tells whether a file has any of our
  annotations without parsing. Only then is the file parsed (pdf-lib, after the
  first paint, yielding to the event loop) to read the models and the object
  numbers of those annotations.
- **Drawing**: the page canvas (pdf.js) keeps drawing every annotation except
  our own ones once they are known: pdf.js skips an annotation whose
  annotation-storage entry says `noView`, and the renderer switches to
  `AnnotationMode.ENABLE_STORAGE` to pass that. Our annotations are drawn by a
  per-page overlay (SVG for marks and shapes, HTML for text boxes and notes)
  from the model. Until a file's own annotations are parsed, pdf.js draws them
  from their appearance streams, which look the same, and pages whose canvas
  still contains them do not draw them in the overlay (no double drawing).
- **Saving**: the writer gets each output page's annotation list (or
  `undefined` = copy the page's annotations as they are). For a page with a
  list it removes the copied annotations that carry `/PFW` and appends new
  annotation dictionaries with appearance streams built from the model
  (highlights use a Multiply blend; Hangul text uses the embedded Malgun Gothic
  subset). Copying pages to another window goes through the same writer, so
  marks travel with the pages and are read back by the receiving window.
- **Annotations other apps touched** (*my call*): an annotation counts as ours
  only while its current appearance stream still carries `/PFWAnnot`; one that
  Acrobat regenerated becomes foreign (still shown and kept, no longer
  editable), even if an older incremental revision still contains the marker.
  Ours are rewritten **in place** under the same object number, so popups and
  replies (`/Parent`, `/IRT`) that other apps attached keep pointing at them.
  Deleting one of ours also removes the popups and replies attached to it, as
  Acrobat does, so no deleted text stays in the file.
- **Text orientation** (*my call*): a new text box or note is upright on screen
  when it is created, whatever the page's `/Rotate` and the view rotation
  (Ctrl+L) are, and that angle is stored with it (0/90/180/270 relative to the
  page's user space). The overlay and the appearance stream both rotate the
  text by that angle; moving or resizing keeps it; shapes, lines, drawings and
  text markup need no angle.
- **Text markup geometry** comes from the browser selection: each client rect
  of the selected range that lies on a page becomes a quad in that page's PDF
  space; rects on the same line are merged; one annotation per page touched.

### UI placement

- `src/markup/` holds the markup toolbar, the per-page overlay, tool handling,
  selection and style state. The viewer exposes page mount/viewport/unmount
  events for it; thumbnails get a scaled, non-interactive overlay.
- Main toolbar order (left to right): sidebar button with View-menu chevron,
  title block, flexible space, highlight split button, markup button, zoom
  segmented control, zoom pill, rotate, ⋯, search, caption buttons.

## Left to the builder

- Exact palettes, icon drawings, handle sizes, hit-test tolerances, arrowhead
  proportions, ink smoothing, the default sizes of click-created shapes, the
  note icon drawing, and the spine gap in Two Pages.
- How text box line breaks are computed for the appearance stream (they should
  match the overlay's wrapping as closely as practical).
- Internal module boundaries inside `src/markup/` and `src/annot/`.
