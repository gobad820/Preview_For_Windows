# Two-page view and markup — build notes

Release: 0.3.0 (`C:\Users\Public\pfw-smoke\Preview 0.3.exe`, `Preview_0.3.0_x64-setup.exe`).

## How it was built

- Contracts on main (Tasks 0.1–0.3): annotation model and geometry, annotations in the
  composition (undo, dirty, page operations), page view events, render generation, toolbar
  and store contracts.
- Three Orca worktrees in parallel: `two-page-view` (agent, Tasks A1–A3), `markup-ui`
  (agent, B1–B5), `annot-core` (me, C1–C4). Each agent ran its own whole-branch review.
- Integration on main: the round-trip e2e test, one set of drawing numbers for overlay and
  appearance streams (`src/annot/style.ts`), then two fresh-context reviews (core;
  integration). Every Important finding was fixed with a test that failed first
  (`0d79dd8`, `2b4b448`).

## Verification

- 453 Vitest and 200 Playwright tests pass; `cargo fmt --check` clean.
- Real Windows (WebView2, driven through DevTools with in-page input events, no desktop
  input): in Two Pages, a drag from the last line of page 1 into the title of page 2 marked
  exactly those lines; rectangle, arrow, a Korean text box and a note were created with the
  tools; Ctrl+S saved; reopening read all of them back as editable and the canvas stopped
  drawing them. The text box embeds a Malgun Gothic subset read through `system_font`
  (`%WINDIR%\Fonts`); the 4-annotation file was 10.6 KB and saving took 660 ms including
  the subset.
- PDFium 156 (Chrome/Edge) renders the saved files like the app: highlight under the text
  (multiply), shapes, arrowhead, Hangul text, note icon (`scripts/pdfium-render.py`), also on
  a `/Rotate 90` page.
- Opening a file without this app's annotations does no extra parsing (byte search for
  `/PFWAnnot` only; about 160 ms for 200 MB).

## Known limitations

- Annotations made by other applications are shown and kept but not editable. Ours stop
  being editable (and are kept as they are) once another app regenerates their appearance
  or changes their `/Rect` or `/Contents`.
- Without Malgun Gothic (not Windows), a text box whose text Helvetica cannot show is saved
  with an appearance that draws only the box; the text is in `/Contents`.
- An annotation object shared by two pages is duplicated for the page that was edited.
- Win+Left snapping of the frameless window was never confirmed with real input.

## Deferred minors (from the branch and integration reviews)

- A drag interrupted by Alt+Tab follows the pointer until the next click; drafts go stale if
  pages move during a drag.
- Delete pressed while a style popover has focus deletes the selected annotation.
- Highlights can be nudged or duplicated off their text (they cannot be dragged).
- No-op undo steps: a drag back to its start; Line Width on a borderless text box.
- Each pointer move redraws the page's SVG (fine for normal pages, slower with many inks).
- Clicking a note icon while its popup is open closes and reopens it.
- With the find field focused, Esc closes find first.
- Two Pages: the remembered navigation target is not cleared when another document opens
  in the same window; `anchoredScrollTop` is no longer used by the viewer.
