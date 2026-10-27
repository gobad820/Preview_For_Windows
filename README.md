# Preview for Windows

A fast, clean PDF viewer and editor for Windows in the spirit of macOS
Preview: a native window that opens instantly, a unified title bar and toolbar,
continuous scrolling or two pages side by side, search, a thumbnail sidebar
where you reorder, delete, copy, paste and merge pages, and Preview's markup
tools: highlight, underline, strike through, shapes, arrows, drawing, text
boxes and notes, saved as standard PDF annotations.

![Preview for Windows showing a document with the sidebar and find bar open](docs/screenshot.png)

## What it does

- Opens a PDF by double-click or "Open with" (the installer registers `.pdf`),
  from the toolbar, with `Ctrl+O`, or by dropping a file onto the window.
- Paints the first page before the rest of the document is processed; only
  the pages near the viewport are kept rendered, so a 300-page file scrolls
  like a 3-page one.
- Zoom: fit width, fit page, presets, `Ctrl` + mouse wheel / trackpad pinch,
  keyboard. Zooming keeps the point under the cursor fixed.
- Sidebar with page thumbnails and the document outline (bookmarks).
- **Page editing in the sidebar, like Preview:** select thumbnails (click,
  Ctrl+click, Shift+click, arrows, Ctrl+A), drag one or many to reorder them,
  delete, copy, cut and paste pages, undo and redo every change.
- **Merging:** drop PDF files from Explorer between two thumbnails, or use
  ⋯ › Insert Pages from File…; password-protected files ask for their
  password (files that are only restricted by an owner password open and save
without one). Pages copied in one Preview window paste into another, and a PDF
  copied in Explorer pastes as pages.
- **Saving:** Ctrl+S writes over the file (atomically, and only when there
  are changes), Ctrl+Shift+S saves a copy and keeps editing it. If another
  program changed the file since it was opened, Preview asks before
  replacing it. The title shows "— Edited" while there are
  unsaved changes, and closing or replacing the document asks first. Saved
  files keep the outline and metadata, internal links follow moved pages, and
  deleted pages leave no trace in the file.
- **Two Pages**: the View menu (the chevron next to the sidebar button)
  switches between Continuous Scroll and Two Pages, with Book Mode to put the
  first page alone on the right like a cover. Fit Width and Fit Page fit the
  whole spread, and → / ← move a spread at a time.
- **Markup**, like Preview's Markup toolbar (the pen-tip button or
  `Ctrl+Shift+A`):
  - Highlight (five colors), underline and strike through selected text. The
    highlight button in the toolbar toggles highlight mode: every selection you
    finish is marked. With text selected, pressing it marks that selection.
  - Rectangle, rounded rectangle, oval, line and arrow (drag, or click for a
    default size; Shift keeps squares, circles and 45° lines), freehand
    drawing, text boxes (Hangul included) and sticky notes.
  - Click an annotation to select it, drag to move, drag the handles to
    resize, arrows to nudge, `Delete` to remove, `Ctrl+D` to duplicate; line
    width, border color, fill and text style apply to the selection and become
    the defaults. Every change is undoable and marks the document edited.
  - Annotations travel with their pages when pages are moved, copied, pasted
    into another window or merged, and the thumbnails show them.
  - Saved as standard annotations with appearance streams, so Acrobat, Edge,
    Chrome and Mac Preview show them as drawn here. Text boxes embed only the
    Malgun Gothic glyphs they use. Reopening a file saved by this app makes its
    annotations editable again; annotations made by other apps are shown and
    kept, but not editable.
- Find in document with highlights and next/previous.
- Text selection and copy, rotation, HiDPI-crisp rendering, light and dark
  theme following Windows.
- Remembers the last page, zoom and rotation per file and the window size.
- Looks like a Mac app: unified 52px title bar and toolbar, Mica backdrop on
  Windows 11, Inter, SF-style icons, Mac-style menus and alerts, light and
  dark themes.
- No network access. No telemetry.

Password-protected and non-PDF files show an inline error instead of a
blank window.

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Open | `Ctrl+O` |
| Find / close find | `Ctrl+F` / `Esc` |
| Next / previous match (in the find field) | `Enter` / `Shift+Enter` |
| Zoom in / out / 100% | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Fit width / fit page | `Ctrl+1` / `Ctrl+2` |
| Rotate clockwise / counter-clockwise | `Ctrl+L` / `Ctrl+Shift+L` |
| Toggle sidebar | `Ctrl+Alt+S` |
| Show / hide the markup toolbar | `Ctrl+Shift+A` |
| Delete / duplicate the selected annotation | `Delete` / `Ctrl+D` |
| Nudge the selected annotation by 1 pt / 10 pt | arrows / `Shift`+arrows |
| End text editing, disarm a tool, deselect | `Esc` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y`, `Ctrl+Shift+Z` |
| Close window | `Ctrl+W` |
| Select pages (sidebar) | click, `Ctrl`+click, `Shift`+click, `↑` `↓`, `Ctrl+A` |
| Copy / Cut / Paste pages | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` (sidebar focused) |
| Delete pages | `Delete` or `Backspace` (sidebar focused) |
| Go to page | `Ctrl+G` |
| Next / previous page (spread in Two Pages) | `→` / `←` |
| Scroll a screen down / up | `Space`, `PageDown` / `Shift+Space`, `PageUp` |
| First / last page | `Home` / `End` |

## Install

Two artifacts come out of a build:

- `Preview.exe`: portable, nothing to install. Needs the WebView2 runtime,
  which every up-to-date Windows 10/11 already has.
- `Preview_<version>_x64-setup.exe`: per-user NSIS installer that also offers
  to associate `.pdf` files.

## Build

The app is built entirely from Linux (WSL2 is fine), cross-compiling to
`x86_64-pc-windows-msvc`. Nothing needs to be installed on Windows.

Prerequisites, all user-space:

- Node 20+ and `npm ci`
- Rust (rustup) with `rustup target add x86_64-pc-windows-msvc`
- `cargo install cargo-xwin` (downloads the MSVC CRT and Windows SDK on first use)
- `clang-cl`, `lld-link`, `llvm-lib`, `llvm-rc` and `makensis` on `PATH`
  (for example from conda-forge: `mamba create -n winbuild -c conda-forge clang lld llvm-tools nsis`)

Then:

```bash
scripts/build-windows.sh            # portable exe only
scripts/build-windows.sh --bundle   # exe + NSIS installer
```

Outputs land in `src-tauri/target/x86_64-pc-windows-msvc/release/`.
`scripts/build-windows.sh` sets the `PATH` for the conda environment used
during development; adjust the two `export` lines if your toolchain lives
elsewhere.

### Development

```bash
npm run dev        # Vite dev server with the browser platform shim (?file=fixtures/simple.pdf)
npm test           # Vitest unit tests (layout math, zoom, search, shortcuts, state, pdf wrapper)
npm run e2e        # Playwright end-to-end tests in headless Chromium
```

In the browser shim, `/?file=fixtures/<name>.pdf` opens a test fixture. The
fixtures in `tests/fixtures` are generated by `scripts/make-fixtures.py`
(reportlab) and include mixed page sizes, a 300-page file, an outline, an
encrypted file, a broken file and a Korean document with both embedded and
non-embedded fonts.

### Driving the real app on the Windows host

`scripts/cdp-windows.ps1` launches `Preview.exe` with WebView2's DevTools
port open on loopback (with its own WebView2 profile, so a Preview window you
already have open is unaffected), runs JavaScript steps inside the app and
prints each result as JSON. It never clicks or types, so it does not interfere
with whoever is using the desktop. This is how saving and merging were checked
against real files on Windows.

### App icon and splash

The app icon is the logo artwork in `src-tauri/icons/source/logo.png` (a blue filter ring
over a beach); `python scripts/make-icons.py` crops it to the lens, rounds the corners and
writes every icon file (needs Pillow).

The splash on the empty window and in About Preview is `src/assets/splash.jpg`, rendered by
`node scripts/make-splash.mjs` from `scripts/splash/splash.html`: a photo by Vincent Yap
(Unsplash License, free for commercial use) with the name set in EB Garamond (SIL Open
Font License 1.1, from the `@fontsource/eb-garamond` dev dependency; only the rendered
image ships).

### Checking saved annotations in other viewers

`scripts/pdfium-render.py FILE PAGE SCALE --png out.png [--probe X,Y ...]`
renders a page with PDFium, the engine of Chrome and Edge, from the
annotations' appearance streams (needs `pypdfium2`). The writer tests use it to
check that a saved rectangle lands where it was drawn, also on `/Rotate` pages.

### Smoke test on the Windows host

From WSL, `scripts/smoke-windows.sh tests/fixtures/simple.pdf` copies the
exe to `C:\Users\Public\pfw-smoke`, launches it with the file, captures the
window to `shot.png` and closes it. The window is not focused, so keyboard
and mouse input on the desktop never land in it.

## Architecture

```
src-tauri/        Tauri 2 shell (Rust): file read, startup argument, dialogs, window state
src/app.ts        wires platform, store and components; open/save/close flows; shortcut dispatch
src/edit/         page editing: composition, history, selection, outline remap, PDF writer,
                  EditableDocument (pages from several files) and the Editor controller
src/annot/        annotation model, geometry, appearance streams, writing and reading them
src/markup/       markup toolbar, page overlays, tools, text marks, annotation editing
src/viewer/       virtualised continuous page view + pure layout and zoom math
src/pdf/          pdf.js document wrapper, cancellable page renderer, text layer
src/search/       pure matcher + find bar with highlights
src/sidebar/      thumbnails and outline
src/toolbar/      toolbar, page indicator, zoom menu
src/platform/     Platform interface, Tauri implementation, browser shim for tests
src/ui/           Mac-style icons, menus and alerts
src/state/        per-file last position and the view preference (localStorage)
```

Design notes live in `docs/superpowers/specs/`, the implementation plan in
`docs/superpowers/plans/`.

## Not in scope (yet)

Editing annotations made by other applications, signatures, stamps, images,
redaction, rich text and font choice in text boxes, a Highlights and Notes
list, form filling, rotating or cropping single pages, dragging thumbnails
between two windows (copy and paste works), printing beyond the webview's own
`Ctrl+P`, and non-PDF formats.
