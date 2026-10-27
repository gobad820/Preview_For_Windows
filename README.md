# Preview for Windows

A fast, clean PDF viewer and editor for Windows in the spirit of macOS Preview:
a native window that opens instantly, a unified title bar and toolbar, continuous
scrolling or two pages side by side, search, a thumbnail sidebar where you reorder,
delete, copy, paste and merge pages, and Preview's markup tools (highlight, underline,
strike through, shapes, arrows, drawing, text boxes and notes) saved as standard PDF
annotations.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="The menu bar above a document in Two Pages, with the thumbnail sidebar and the markup toolbar open, showing a highlight, an underline, a strikethrough, a rounded rectangle, an arrow, a text box, a note, an oval and a freehand check mark" src="docs/screenshot.png">
</picture>

**Version 0.4.2** · Windows 10 and 11, x64 · portable `Preview.exe` (about 7 MB) or a
per-user installer (about 4.6 MB) · no network access, no telemetry.

## Contents

- [What it does](#what-it-does)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Install](#install)
- [Tech stack](#tech-stack)
- [Build](#build)
- [Development](#development)
- [Project layout](#project-layout)
- [Version history](#version-history)
- [Credits and licenses](#credits-and-licenses)
- [Not in scope yet](#not-in-scope-yet)

## What it does

**Opening and viewing**

- Opens a PDF by double-click or "Open with" (the installer registers `.pdf`), from the
  toolbar, with `Ctrl+O`, or by dropping a file onto the window.
- Paints the first page before the rest of the document is processed. Only the pages
  near the viewport stay rendered, so a 300-page file scrolls like a 3-page one.
- Continuous Scroll or Two Pages (View menu, the chevron next to the sidebar button),
  with Book Mode to put the first page alone on the right like a cover. Fit Width and
  Fit Page fit the whole spread, and `→` / `←` move a spread at a time.
- Zoom: Fit Width, Fit Page, presets, `Ctrl` + mouse wheel or trackpad pinch, keyboard.
  Zooming keeps the point under the cursor fixed.
- Sidebar with page thumbnails and the document outline (bookmarks).
- Find in document with highlights and next/previous; text selection and copy;
  rotation; HiDPI-crisp rendering.
- Remembers the last page, zoom and rotation per file, the window size, and the page
  layout.

**Editing pages**, like Preview's sidebar

- Select thumbnails (click, `Ctrl`+click, `Shift`+click, arrows, `Ctrl+A`), drag one or
  many to reorder them, delete, copy, cut and paste pages, undo and redo every change.
- Merge: drop PDF files from Explorer between two thumbnails, or use ⋯ › Insert Pages
  from File…. Password-protected files ask for their password; files that are only
  restricted by an owner password open and save without one. Pages copied in one Preview
  window paste into another, and a PDF copied in Explorer pastes as pages.
- Save: `Ctrl+S` writes over the file (atomically, and only when there are changes);
  `Ctrl+Shift+S` saves a copy and keeps editing it. If another program changed the file
  since it was opened, Preview asks before replacing it. The title shows "— Edited"
  while there are unsaved changes, and closing or replacing the document asks first.
  Saved files keep the outline and metadata, internal links follow moved pages, and
  deleted pages leave no trace in the file.

**Markup**, like Preview's Markup toolbar (the pen-tip button or `Ctrl+Shift+A`)

- Highlight (five colors), underline and strike through selected text. The highlight
  button toggles highlight mode: every selection you finish is marked. With text
  selected, pressing it marks that selection.
- Rectangle, rounded rectangle, oval, line and arrow (drag, or click for a default size;
  `Shift` keeps squares, circles and 45° lines), freehand drawing, text boxes (Hangul
  included) and sticky notes.
- Click an annotation to select it, drag to move, drag the handles to resize, arrows to
  nudge, `Delete` to remove, `Ctrl+D` to duplicate. Line width, border color, fill and
  text style apply to the selection and become the defaults. Every change is undoable.
- Annotations travel with their pages when pages are moved, copied, pasted into another
  window or merged, and the thumbnails show them.
- Saved as standard annotations with appearance streams, so Acrobat, Edge, Chrome and
  Mac Preview show them as drawn here. Text boxes embed only the Malgun Gothic glyphs
  they use. Reopening a file saved by this app makes its annotations editable again;
  annotations made by other apps are shown and kept, but not editable.

**Menu bar and Settings**

- A menu bar inside the window (Preview, File, Edit, View, Go, Tools, Window, Help),
  continuous with the toolbar like a macOS title bar, with every feature of the app in it.
  It is the window's title bar: the minimize, maximize and close buttons sit in its
  top-right corner (in the toolbar's corner while the bar is hidden). Click a title and slide across the others
  like on a Mac, or use the keyboard like on Windows: `Alt` or `F10` focuses the bar,
  `Alt`+underlined letter opens a menu, arrows move, `Enter` runs. View › Menu Bar hides
  it; `Alt` still brings it back. Help › Keyboard Shortcuts lists every shortcut.
- Settings… (`Ctrl+,`) opens a macOS-style Settings window with General, Markup and Window
  panes: default zoom for new files, page layout and Book Mode, showing the sidebar when
  a document opens, remembering each file's position, the default highlight color, shape
  color, line width and text size, and showing the menu bar. Changes apply at once.
- Both follow the light and dark theme like the rest of the window.

**Looks like a Mac app**

- Unified 52 px title bar and toolbar, Mica backdrop on Windows 11, Inter, SF-style
  icons, Mac-style menus and alerts, light and dark themes following Windows.
- The empty window shows the splash; ⋯ › About Preview shows the version.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/empty-window-dark.jpg">
  <img alt="The empty window: a lighthouse photo with the name Preview for Windows 0.3, an Open button and a hint to drop a file" src="docs/empty-window.jpg" width="640">
</picture>

Password-protected and non-PDF files show an inline error instead of a blank window.

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Open | `Ctrl+O` |
| Settings | `Ctrl+,` |
| Menu bar: focus / open a menu | `Alt` or `F10` / `Alt`+underlined letter |
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

A build produces two files:

- `Preview.exe`: portable, nothing to install. Needs the WebView2 runtime, which every
  up-to-date Windows 10/11 already has.
- `Preview_<version>_x64-setup.exe`: per-user NSIS installer that also offers to
  associate `.pdf` files.

## Tech stack

| Part | Technology |
| --- | --- |
| Native shell | Rust 1.99 and [Tauri 2](https://tauri.app) (dialog and window-state plugins, clipboard-win) |
| Web view | Microsoft Edge WebView2, already part of Windows |
| UI | TypeScript 7, plain DOM (no framework), Vite 8; Inter for text |
| Reading PDFs | [pdf.js](https://mozilla.github.io/pdf.js/) 6.4 (`pdfjs-dist`), assets bundled for offline use |
| Writing PDFs | `@cantoo/pdf-lib` 2.11 and `@cantoo/fontkit` 2.0 (Malgun Gothic subsets) |
| Build | Cross-compiled from Linux/WSL2 with cargo-xwin, clang-cl and lld-link; NSIS installer |
| Tests | Vitest 5 (508 unit tests), Playwright 1.64 (258 end-to-end tests), PDFium checks of saved files, WebView2 DevTools checks of the real exe |

Versions, licenses, the reasons behind each choice and how the tests are layered are in
[docs/tech-stack.md](docs/tech-stack.md).

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
`scripts/build-windows.sh` sets the `PATH` for the conda environment used during
development; adjust the two `export` lines if your toolchain lives elsewhere.

## Development

```bash
npm run dev        # Vite dev server with the browser platform shim (?file=fixtures/simple.pdf)
npm test           # Vitest unit tests
npm run e2e        # Playwright end-to-end tests in headless Chromium (build + preview server)
npx tsc --noEmit   # type check
```

In the browser shim, `/?file=fixtures/<name>.pdf` opens a test fixture. The fixtures in
`tests/fixtures` are generated by `scripts/make-fixtures.py` (reportlab) and include
mixed page sizes, a 300-page file, an outline, links, encrypted and broken files, a
rotated page, annotations from other apps and a Korean document with both embedded and
non-embedded fonts.

Playwright starts its own preview server on `PW_PORT` (default 4173). Give every
checkout that runs tests at the same time its own port, for example
`PW_PORT=4411 npx playwright test`.

### Driving the real app on the Windows host

`scripts/cdp-windows.ps1` launches `Preview.exe` with WebView2's DevTools port open on
loopback (with its own WebView2 profile, so a Preview window you already have open is
unaffected), runs JavaScript steps inside the app and prints each result as JSON. It
never clicks or types on the desktop, so it does not interfere with whoever is using
the machine. Saving, merging and markup were checked this way against real files.

From WSL, `scripts/smoke-windows.sh tests/fixtures/simple.pdf` copies the exe to
`C:\Users\Public\pfw-smoke`, launches it with the file, captures the window to
`shot.png` and closes it, without focusing the window.

### Checking saved annotations in other viewers

`scripts/pdfium-render.py FILE PAGE SCALE --png out.png [--probe X,Y ...]` renders a
page with PDFium, the engine of Chrome and Edge, from the annotations' appearance
streams (needs `pypdfium2`). The writer tests use it to check that a saved rectangle
lands where it was drawn, also on `/Rotate` pages.

### App icon and splash

The app icon is the logo artwork in `src-tauri/icons/source/logo.png` (a blue filter
ring over a beach); `python scripts/make-icons.py` crops it to the lens, rounds the
corners and writes every icon file (needs Pillow).

The splash on the empty window and in About Preview is `src/assets/splash.jpg`, rendered
by `node scripts/make-splash.mjs` from `scripts/splash/splash.html`; it shows the major and minor
version from `package.json`, so re-run it after a minor version bump.

## Project layout

```
src-tauri/          Tauri 2 shell (Rust): file read/write, startup file, dialogs, window state,
                    Mica, clipboard, system font
src/app.ts          wires platform, store and components; open/save/close flows; shortcut dispatch;
                    registers every feature as a command
src/commands.ts     the command registry menus are built from
src/menubar/        the in-window menu bar: menus as lists of command ids, drop-downs,
                    keyboard handling, the Keyboard Shortcuts panel
src/settings/       the settings model (localStorage) and the Settings window
src/store.ts        app state with subscriptions
src/viewer/         virtualised page view (continuous and two pages) + pure layout and zoom math
src/pdf/            pdf.js document wrapper, cancellable page renderer, text layer
src/edit/           page editing: composition, history, selection, outline remap, PDF writer,
                    EditableDocument (pages from several files) and the Editor controller
src/annot/          annotation model, geometry, appearance streams, writing and reading them
src/markup/         markup toolbar, page overlays, tools, text marks, annotation editing
src/search/         pure matcher + find bar with highlights
src/sidebar/        thumbnails and outline
src/toolbar/        toolbar, page indicator, zoom menu
src/platform/       Platform interface, Tauri implementation, browser shim for tests
src/ui/             Mac-style icons, menus, alerts and the About window
src/state/          per-file last position (localStorage)
src/assets/         Inter font, splash image
tests/unit/         Vitest
tests/e2e/          Playwright
tests/fixtures/     test PDFs (generated)
scripts/            build, fixtures, icons, splash, screenshots, Windows checks
docs/               tech stack, screenshots, design specs and plans (docs/superpowers/)
```

Each feature has a design document in `docs/superpowers/specs/` and a plan in
`docs/superpowers/plans/`.

## Version history

| Version | Date | What changed |
| --- | --- | --- |
| 0.1 | 2026-10-26 | Viewer: open, continuous scroll, zoom, find, thumbnails and outline, rotation, remembered position |
| 0.2 | 2026-10-26 | Page editing in the sidebar (reorder, delete, copy, paste, merge, undo, save) and the Mac-style interface |
| 0.3.0 | 2026-10-26 | Two Pages with Book Mode, and Markup: text marks, shapes, arrows, ink, text boxes, notes |
| 0.3.1 – 0.3.3 | 2026-10-26 – 27 | App icon from the author's artwork, splash and About window |
| 0.3.4 | 2026-10-27 | Photographic splash with the name set in EB Garamond |
| 0.3.5 | 2026-10-27 | Square corners on the splash and the About window |
| 0.4.0 | 2026-10-27 | In-window menu bar and Settings window (first in the style of Mac OS X Lion); every feature is a named command |
| 0.4.1 | 2026-10-27 | Menu bar, its menus, Keyboard Shortcuts and Settings restyled to match the modern macOS look of the rest of the window, with dark mode |
| 0.4.2 | 2026-10-27 | Window buttons in the top-right corner of the title bar; menu bar lined up with the toolbar; Settings opens below the toolbar; the splash shows the current version |

## Credits and licenses

- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0),
  [pdf-lib by Cantoo](https://github.com/cantoo-scribe/pdf-lib) and fontkit (MIT),
  [Tauri](https://tauri.app) (MIT / Apache-2.0).
- [Inter](https://rsms.me/inter/) by Rasmus Andersson, SIL Open Font License 1.1
  (`src/assets/fonts/OFL.txt`).
- Splash photo by Vincent Yap on [Unsplash](https://unsplash.com) (Unsplash License).
  The name on it is set in EB Garamond (SIL Open Font License 1.1); only the rendered
  image ships.
- Malgun Gothic is read from the user's own Windows installation and never bundled.

## Not in scope yet

Editing annotations made by other applications, signatures, stamps, images, redaction,
rich text and font choice in text boxes, a Highlights and Notes list, form filling,
rotating or cropping single pages, dragging thumbnails between two windows (copy and
paste works), printing beyond the web view's own `Ctrl+P`, and non-PDF formats.
