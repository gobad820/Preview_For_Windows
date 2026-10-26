# Preview for Windows — verification notes (2026-10-26)

What was verified, where, and what is still unverified. Companion to
`2026-10-26-pdf-viewer.md`.

## Verified

| What | How | Result |
| --- | --- | --- |
| Pure modules (store, layout, zoom, shortcuts, search, file state, pdf wrapper) | `npm test` (Vitest, Node) | 149 tests green |
| Viewer, toolbar, sidebar, find bar, shortcuts, state restore, error handling | `npm run e2e` (Playwright, headless Chromium, 1× and 2× DPR projects) | 46 tests green |
| First paint budget | e2e asserts `firstPaint - openStart < 1000 ms` for `simple.pdf` and `long300.pdf` | passes (typically < 300 ms in Chromium) |
| Cross-build from WSL | `scripts/build-windows.sh --bundle` (cargo-xwin, clang-cl/lld-link, makensis) | `Preview.exe` 3.3 MB, `Preview_0.1.0_x64-setup.exe` 3.6 MB |
| Real Windows host | `scripts/smoke-windows.sh` launches the exe with a fixture and captures its window with `PrintWindow` | Window titled with the file name; toolbar rendered; page 1 of `long300.pdf` painted 1.6 s after process start (WebView2 startup included); `한글 문서.pdf` renders both the embedded Noto Sans KR page and the non-embedded CID-font page |
| Non-ASCII path on Windows | smoke launch with `C:\Users\Public\pfw-smoke\한글 문서.pdf` | opened, title correct |

## Not verified on Windows (only in Chromium)

- Native drag-and-drop onto the window (`onDragDropEvent`), the native open
  dialog, and the window-state plugin: wired and type-checked, but the smoke
  test cannot drive the UI without stealing focus from whoever is using the
  desktop.
- The NSIS installer and the `.pdf` file association: built, not installed.
- Keyboard shortcuts inside WebView2 (`hardenWebview` blocks F5/Ctrl+R etc.).
- Trackpad pinch (wheel events with `ctrlKey`) on a real touchpad.

## Code review (fresh-context reviewer, whole branch)

Verdict: no critical issues; five important ones, all fixed in
`fix: address code review findings`: canvas backing-store cap at extreme
zoom, `page.cleanup()` when pages leave the viewport, UNC-safe startup
paths (`std::path::absolute`), arrow-key panning when the page is wider
than the viewport, and a password prompt for encrypted PDFs. Minor items
fixed: Escape scoping, loading cue, outline top level expanded,
`menuitemradio` roles, narrower dialog permission, `cargo fmt --check`
in the build script, unused members. Left as noted below: thumbnails do
not re-render on a DPR change; the find bar's initial scroll ignores a
non-zero MediaBox origin (self-corrects).

## Known gaps / follow-ups

- Find highlights are approximate at the glyph level (pdf.js text layer
  scaling), same as pdf.js's own viewer.
- `goToPage(index, top)` ignores `top` when the document is rotated.
- Outline destinations are resolved eagerly; a document with thousands of
  bookmarks would pay that cost when the outline tab is first shown.
- No single-instance handling: double-clicking a second PDF opens a second
  window (deliberate, matches Preview).
- The smoke script's first version used `SetForegroundWindow`, which made
  the user's concurrent keyboard/mouse input land in the test window. It is
  now opt-in (`focus` argument) and the capture uses `PrintWindow`, so other
  windows never appear in captures.
