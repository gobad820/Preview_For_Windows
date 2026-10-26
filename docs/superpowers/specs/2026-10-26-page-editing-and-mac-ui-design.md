# Page editing and Mac-style UI — design

Date: 2026-10-26
Status: approved by goal directive (`/goal`), autonomous build
Builds on: `2026-10-26-pdf-viewer-design.md` (v1, read-only viewer)

## Intent

The user's words: "Mac Preview처럼 썸네일에서 페이지 순서 바꾸기, 여러 장 드래그,
삭제·복사·붙여넣기, 다른 PDF 파일 끌어 넣어 합치기(이거 중요함), 실행 취소, 저장까지
되는 PDF 편집 기능 + UI도 조금 더 맥스럽게, 지금 너무 디자인 촌스러움."

v1 deliberately left page reordering and merging out. In macOS Preview the
thumbnail sidebar is also the page editor: you drag pages to reorder them,
drag a PDF from Finder between two thumbnails to merge it, delete, copy and
paste pages, undo, and save. That is what people use Preview for beyond
reading, and merging is the most important part.

The second half is visual: the v1 chrome reads as a generic web app. It
should feel like a Mac app: unified title bar and toolbar, quiet icons,
translucent sidebar, Mac-style menus, selection and alert styles.

## Goals

### Page editing (sidebar is the editor)

- **Select** thumbnails: click selects one and shows it; Ctrl+click toggles;
  Shift+click selects a range from the anchor; Ctrl+A in the sidebar selects
  all. Arrow keys in the focused sidebar move the selection (Shift extends).
  When the sidebar has focus the selection is accent blue, otherwise gray.
- **Reorder** by dragging one or many selected thumbnails; a ghost stack with
  a count badge follows the pointer, a blue insertion line shows the target
  gap, the sidebar auto-scrolls near its edges, Esc cancels.
- **Delete** selected pages with Delete or Backspace. The last remaining page
  cannot be deleted.
- **Copy / Cut / Paste** pages with Ctrl+C / Ctrl+X / Ctrl+V while the sidebar
  has focus. Paste inserts after the last selected page and selects the
  pasted pages. Paste also works with focus in the document view.
- **Between windows**: copying pages also puts a PDF of them on the Windows
  clipboard as a file, so Ctrl+V in another Preview window inserts them.
  A PDF file copied in Explorer pastes the same way.
- **Merge (most important)**: drop one or more PDF files from Explorer onto
  the sidebar; an insertion line shows where they go; their pages are
  inserted at that gap. "Insert Pages from File…" in the ⋯ menu does the same
  through a file dialog. Password-protected files prompt for the password.
- **Undo / Redo** every structural edit: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z.
- **Save**: Ctrl+S overwrites the opened file; Ctrl+Shift+S saves a copy under
  a new name and the window then edits that file. The title shows
  "— Edited" while there are unsaved changes; undoing back to the saved state
  clears it. Closing the window, opening another file into this window, or
  Ctrl+W with unsaved changes asks Save / Don't Save / Cancel.
- **Outline survives editing**: the Table of Contents in the sidebar and in
  the saved file follows pages to their new positions; entries whose page
  was deleted disappear unless they still have children.
- **Saved files are clean**: deleted pages leave no trace in the saved file,
  internal links are retargeted to the moved pages, document metadata
  (title, author, subject, keywords) is kept, and a file that was password
  protected is saved without the password (as Preview does after unlocking).

### Mac-style UI

- **Unified chrome**: no separate Windows title bar. One 52px toolbar is the
  title bar: drag to move, double-click to maximize, Windows caption buttons
  (minimize, maximize/restore, close) at the right edge so Windows habits
  keep working. Rounded corners and shadow on Windows 11.
- **Title block** at the left after the sidebar button: file name in 13px
  semibold with " — Edited" in secondary text, and below it "Page 3 of 12"
  where the number is an inline editable field.
- **Toolbar right side**: zoom out / zoom in as one segmented control, a zoom
  value pill with a menu (Fit Width, Fit Page, presets), rotate, a ⋯ menu
  (Open…, Save, Save As…, Insert Pages from File…, Undo, Redo) and a search
  button that expands into a rounded Mac-style search field with match count
  and previous/next.
- **Materials**: on Windows 11 the toolbar and sidebar use Mica, the closest
  Windows equivalent of macOS vibrancy; elsewhere they use solid colors that
  look the same in both themes. The document area is a calm neutral gray.
- **Typography and icons**: Inter (bundled, OFL) for UI text with Malgun
  Gothic fallback for Hangul; thin, rounded 18px stroke icons in the spirit of
  SF Symbols.
- **Sidebar**: a segmented control switches Thumbnails / Table of Contents;
  thumbnails have a hairline border and soft shadow; the page number sits
  under each thumbnail and turns into a filled capsule when selected.
- **Menus and alerts**: Mac-style menus (rounded, translucent, shortcuts
  right-aligned, keyboard navigable) for the zoom menu, ⋯ menu and thumbnail
  context menu; Mac-style alerts for password entry and unsaved changes.
- Light and dark themes both get the same care.

## Non-goals

- Dragging thumbnails between two windows. Copy/paste covers it for now;
  each window is still its own process.
- Rotating individual pages, cropping, annotations, forms, signing,
  inserting blank pages or images, printing changes.
- Autosave or versions. Saving is explicit.
- Keeping interactive form fields working across a save; their appearance
  is kept, interactivity is not.
- Mac traffic-light buttons. The caption buttons stay where Windows users
  expect them.

## Anti-goals

- Losing work: no path may discard unsaved edits without asking.
- Leaking deleted pages: a saved file must not contain objects of pages the
  user deleted.
- A slower viewer: reorder, delete and paste must feel instant on a 300-page
  file; only visible pages may re-render after an edit.
- Gimmicky Mac imitation that fights Windows (fake traffic lights, broken
  snapping or resizing).

## Constraints

- Same toolchain and verification layers as v1 (WSL cross-build, Vitest,
  Playwright, Windows smoke via `scripts/smoke-windows.sh`).
- Per the user's working style, features are built on separate branches in
  Orca worktrees and merged to main.
- Tauri's native drag-and-drop must stay enabled to receive Explorer drops
  with positions, which disables HTML5 drag-and-drop inside WebView2 on
  Windows. All in-page dragging therefore uses pointer events.

## How it gets made (decided)

- **Document model**: an `EditableDocument` holds one or more *sources*
  (each a pdf.js document) and a *composition*: an ordered list of page
  references `{id, src, index}`. Viewing, thumbnails, search and outline read
  pages through the composition, so edits are array operations that take
  microseconds; nothing is re-parsed. Undo/redo is a history of
  compositions. Sources are kept for the window's lifetime so undo always
  works.
- **Saving**: `@cantoo/pdf-lib` (maintained MIT fork of pdf-lib, supports
  decrypting with a password) builds a fresh PDF from the composition. Before
  copying, link destinations and annotation `/P` back-references are
  detached so the copier cannot drag in other pages; after copying they are
  retargeted to the new pages or dropped. The outline is rebuilt from the
  remapped outline; metadata is copied from the first source. Writes are
  atomic (temp file + rename) through a Rust command that takes the raw
  bytes.
- **Clipboard between windows**: Rust writes the copied pages to a temp PDF
  and puts it on the clipboard as a file list (`clipboard-win`); the clipboard
  sequence number tells a window whether the clipboard still holds its own
  copy (use the in-memory pages) or something newer (read the files).
- **Opening while a document is open** (Ctrl+O, dropping a file onto the
  document area) opens a new window, like Preview. Only an empty window
  loads the file in place.
- **Window chrome**: `decorations: false`, `transparent: true`, `shadow: true`;
  Rust applies Mica when the OS build is ≥ 22000 and reports the material to
  the page, which then turns chrome backgrounds translucent.
- **Shortcut changes**: Ctrl+Shift+S becomes Save As; the sidebar toggle
  moves to Ctrl+Alt+S (macOS uses ⌥⌘S). Ctrl+W closes the window.

## Left to the builder

- Exact colors, spacing, icon drawings and animation timings within the
  stated direction.
- Thumbnail ghost appearance and auto-scroll speed curve.
- Whether menus are built from a declarative list or DOM templates.
