# English / Korean UI — design and worker briefs

Date: 2026-10-27
Builds on: v0.4.2

## Intent

The user: "언어를 영어/한글 선택해서 할 수 있도록 마지막으로 할 것." Every piece of text the app
shows can be English or Korean, chosen in Settings, and switching takes effect at once,
without restarting and without losing the open document.

## Decided (contracts on main)

- **`src/i18n/`**: `t(key, params)` returns the text in the current locale; `{name}`
  placeholders; a message may be a function `(p) => string` where word order or plurals
  need it (Korean has no plural; English "1 page" / "2 pages"). `setLocale`, `locale()`,
  `resolveLanguage(language)`.
- **Catalogs, one per worker**: `src/i18n/menus.ts` (keys `menu.*`), `src/i18n/chrome.ts`
  (`chrome.*`), `src/i18n/dialogs.ts` (`dlg.*`). Each exports `en` and `ko`; the type
  requires Korean to have every English key. `tests/unit/i18n.test.ts` checks every locale
  has every key with the same placeholders, no empty text, and no key in two catalogs.
- **Setting**: `Settings.language: 'system' | 'en' | 'ko'`, default `system` (follows
  Windows' display language: Korean Windows gets Korean). My call: an "Automatic" choice
  besides the two the user named, as the default, so a Korean Windows opens in Korean.
- **Live switch**: the App calls `setLocale` before it builds any UI and whenever the
  setting changes, then sets the store's `locale`. Components that built text earlier
  subscribe to `store.select('locale', …)` and re-render it; menus read labels when they
  open; `document.documentElement.lang` follows (Chromium then picks Korean font fallback).
- **Fonts**: no new font. `--font` is Inter then Malgun Gothic, so Hangul uses Malgun
  Gothic on Windows. In WSL screenshots Korean falls back to a monospace Hangul font; for
  visual review load `/mnt/c/Windows/Fonts/malgun.ttf` into the capture page only (as
  `scripts`' captures do with Segoe Fluent Icons), never bundle it.
- **Brand**: the product name stays "Preview" in both languages ("Preview에 관하여").
  Keyboard shortcuts stay as written (`Ctrl+S`), as on Korean Windows.
- **Korean style**: macOS Korean conventions. Labels are noun phrases. Alert sentences use
  the 합니다체 ("…저장하겠습니까?", "…할 수 없습니다."). Ellipsis "…" kept on commands that
  open a dialog. Quotes in sentences: ‘…’ around file names.
- **Tests**: Playwright's browser runs in English, so `system` → English and existing
  tests keep passing. New tests switch with
  `__pfw.app.settings.set({ language: 'ko' })` (live) or by seeding
  `localStorage['pfw.settings'] = '{"language":"ko"}'` in `addInitScript` (startup).

## Glossary (use these exact Korean terms)

| English | 한국어 | English | 한국어 |
| --- | --- | --- | --- |
| File | 파일 | Edit | 편집 |
| View | 보기 | Go | 이동 |
| Tools | 도구 | Window | 윈도우 |
| Help | 도움말 | About Preview | Preview에 관하여 |
| Settings… | 설정… | Keyboard Shortcuts | 키보드 단축키 |
| Open… | 열기… | Save | 저장 |
| Save As… | 다른 이름으로 저장… | Print… | 프린트… |
| Close Window | 윈도우 닫기 | Insert Pages from File… | 파일에서 페이지 삽입… |
| Undo / Redo | 실행 취소 / 실행 복귀 | Cut / Copy / Paste | 오려두기 / 복사하기 / 붙여넣기 |
| Delete | 삭제 | Duplicate | 복제 |
| Select All Pages | 모든 페이지 선택 | Find… | 찾기… |
| Show / Hide Sidebar | 사이드바 보기 / 사이드바 가리기 | Thumbnails | 축소판 |
| Table of Contents / Contents | 목차 | Continuous Scroll | 연속 스크롤 |
| Two Pages | 두 페이지 | Book Mode | 책 모드 |
| Actual Size | 실제 크기 | Fit Width / Fit Page | 폭 맞춤 / 페이지 맞춤 |
| Zoom In / Zoom Out | 확대 / 축소 | Rotate Left / Right | 왼쪽으로 회전 / 오른쪽으로 회전 |
| Show / Hide Markup Toolbar | 마크업 도구 막대 보기 / 가리기 | Menu Bar | 메뉴 막대 |
| Next / Previous Page | 다음 페이지 / 이전 페이지 | First / Last Page | 첫 페이지 / 마지막 페이지 |
| Go to Page… | 페이지로 이동… | Text Selection | 텍스트 선택 |
| Highlight | 하이라이트 | Underline / Strikethrough | 밑줄 / 취소선 |
| Draw / Line / Arrow | 그리기 / 선 / 화살표 | Rectangle / Rounded Rectangle / Oval | 사각형 / 둥근 사각형 / 타원 |
| Text / Note | 텍스트 / 메모 | Minimize / Maximize / Restore / Close | 최소화 / 최대화 / 이전 크기로 복원 / 닫기 |
| Zoom (Window menu) | 확대/축소 | Edited | 편집됨 |
| Page | 페이지 | General / Markup / Window (Settings) | 일반 / 마크업 / 윈도우 |
| Language / Automatic | 언어 / 자동(시스템 설정) | English / 한국어 (choices) | English / 한국어 (always in their own language) |
| Cancel / OK | 취소 / 확인 | Don't Save | 저장 안 함 |
| Replace | 대치 | Open a PDF | PDF 열기 |
| Colors / Line width / Fill / Border / Text style | 색상 / 선 두께 / 채우기 / 테두리 / 텍스트 스타일 | Password | 암호 |

## Worker `i18n-menus` — PW_PORT 4451, catalog `src/i18n/menus.ts`

Command labels in `App.registerCommands()` (`src/app.ts`) become `() => t(…)`; the menu bar
(`src/menubar/menus.ts`, `menubar.ts`), Help › Keyboard Shortcuts (`shortcutsPanel.ts`); the
toolbar's View menu (`App.viewMenu`), ⋯ menu (`App.moreMenu`), page context menu
(`App.pageContextMenu`) and zoom menu (`src/toolbar/toolbar.ts` `showZoomMenu` items only;
the zoom pill's own label belongs to `i18n-chrome`). Menu bar titles in Korean: access keys
keep their English letters; while access keys are shown (Alt or keyboard), a Korean title
reads "파일(F)" like Korean Windows, otherwise just "파일". Alt+F etc. work in both languages.
The menu bar's titles re-render on locale change; an open menu closes.

## Worker `i18n-chrome` — PW_PORT 4461, catalog `src/i18n/chrome.ts`

`src/toolbar/toolbar.ts` (tooltips, aria-labels, title block and "Page [n] of N" — Korean
word order may need a different template, zoom pill label), `src/search/findbar.ts`,
`src/sidebar/*` (tabs, outline empty state), `index.html` empty state / loading / drop
overlay (render from TS, or `data-i18n` attributes applied by a small helper you own),
`src/markup/bar.ts`, `popover.ts`, `controller.ts` (tooltips, palette and colour names,
line widths, text style), `src/ui/about.ts` caption, `src/ui/caption.ts` button tooltips,
the window title (`App.updateTitle`: "name — Edited"), the empty-window toolbar title.

## Worker `i18n-dialogs` — PW_PORT 4471, catalog `src/i18n/dialogs.ts`

Alerts and their buttons in `src/app.ts` (unsaved changes, changed on disk, replace,
close, insert pages, save and open failures, `fail`, `askPassword`) and `src/ui/dialog.ts`
defaults; error texts from `src/pdf/document.ts`, `src/edit/writer.ts`,
`src/edit/document.ts`, `src/annot/reader.ts` (the messages users see; keep error *types*);
native open/save dialog titles and filter names (`src/platform/tauri.ts`); the Settings
window (`src/settings/panel.ts`: titles, tabs, labels, captions, pop-up choices) plus a new
**Language** row at the top of the General pane: pop-up "Automatic (System) / English /
한국어" bound to `settings.language`. An open Settings window re-renders when the language
changes (it can be the window that changed it).

## Rules for all three

- Read this document; `npm ci`; TDD; gates before every commit: `npx tsc --noEmit`,
  `npx vitest run`, `PW_PORT=<port> npx playwright test` (full suite green; never 4173).
- Add keys only to your own catalog, with your prefix; use the glossary terms. Change only
  your own files and the strings of your areas in shared files (`src/app.ts`: only the
  methods named for you). Do not change behaviour, layout, the contracts in `src/i18n/index.ts`
  / `types.ts`, the settings model or other catalogs. Do not bump the version, build the exe,
  push or merge.
- Every visible string of your areas goes through `t()`: text, `title`, `aria-label`,
  placeholders. Add e2e tests that switch to Korean (live and at startup) and check your
  areas, including that text built before the switch updates, and that English comes back.
- Check light and dark screenshots in Korean (with Malgun Gothic loaded as above) for text
  that overflows, wraps badly or misaligns, and fix the layout of your own areas.
- Commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; post progress with
  `orca worktree set --worktree active --comment "…" --json`; at the end set
  `--workspace-status in-review` and print a short summary with screenshot paths.
