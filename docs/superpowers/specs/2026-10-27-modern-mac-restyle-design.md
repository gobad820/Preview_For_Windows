# Menu bar and Settings: from Mac OS X Lion to modern macOS — design and worker briefs

Date: 2026-10-27
Builds on: v0.4.0 (`docs/superpowers/specs/2026-10-27-menu-bar-and-settings-design.md`)

## Intent

The user, after trying 0.4.0: "느낌은 좋은데 … 맨 위랑 밑에 디자인적으로 안 맞음. 차라리 위 그
Lion 테마를 아래 테마로 변경해서 좀 더 현대적으로, 현대적 Mac으로." The Lion menu bar
(grey gradient, Lucida, blue gradient highlight) clashes with the modern macOS toolbar
under it (Inter, flat chrome, SF-style icons). Restyle everything that is Lion — the menu
bar, its drop-downs, Help › Keyboard Shortcuts and the Settings window — in the app's own
modern macOS language (Sonoma / Sequoia), so the window reads as one design.

Behaviour does not change: menus, commands, keyboard handling, settings, persistence and
their tests stay as they are. Only the look changes, plus dark mode.

## Decided

- **One design language: the app's existing tokens** in `:root` of `src/styles.css`
  (`--font` Inter, `--chrome-bg`, `--hairline`, `--text*`, `--icon`, `--accent`,
  `--accent-strong`, `--accent-fg`, `--fill-hover|pressed|quiet|selected`, `--control-*`,
  `--field-border`, `--menu-bg`, `--menu-ring`, `--menu-shadow`, `--alert-bg`, `--scrim`,
  `--radius-control|menu|alert`, `--focus-ring`). They already have dark values; the
  restyled parts **follow the light and dark theme** (the "stays light, Lion had no dark
  mode" rule is dropped).
- **No `--lion-*` tokens and no Lucida** anywhere after this change. The coordinator
  deletes the `--lion-*` tokens from `:root` after both branches merge; workers stop using
  them.
- **Reference look for drop-downs: the app's existing menus** (`src/ui/menu.ts`, the
  `.menu` styles: View menu, zoom menu, ⋯ menu, context menus). A menu bar drop-down and a
  Settings pop-up list must be indistinguishable from those: same background with blur,
  ring, shadow, radius, padding, item height, font size, highlight, check marks, shortcut
  colour and separators.
- **Reference look for panels: the app's alerts and About window** (`src/ui/dialog.ts`,
  `src/ui/about.ts`): radius, background, ring, shadow, scrim.

## Branch `menubar-modern` (worker) — PW_PORT 4431

- Menu bar: same background as the toolbar under it (`--chrome-bg`, including the
  translucent Mica variant the toolbar uses on Windows 11), no gradient and no line between
  bar and toolbar, so the two read as one unified title area; the toolbar keeps its own
  bottom hairline. Height 24 px. `--font` 13 px, weight 400; the app menu "Preview" weight
  600.
- Open or keyboard-focused title: macOS Big Sur+ style, a rounded rect (radius 5 px) of
  `--fill-pressed` behind the title, text colour unchanged — no blue.
- Drop-downs: the `.menu` look above, all four corners rounded, opening 2–3 px below the
  bar, highlight = `--accent-strong` rounded rect with `--accent-fg` text (shortcut turns
  white too), disabled `--text-tertiary`, shortcuts `--text-secondary`, separators
  `--hairline` inset. Reuse the `.menu` CSS or its tokens; do not hand-copy colours.
- Access-key underlines only while the keyboard drives the bar (as now).
- Help › Keyboard Shortcuts: a modern panel like the alerts (radius, `--alert-bg` with
  blur, ring, shadow, scrim), grouped list with section headers in `--text-secondary`,
  key caps like the existing `kbd` style of the empty window, light and dark.
- When the bar is hidden and Alt peeks it, it overlays the toolbar with the same look.
- Update tests that assert Lion styles; add e2e that the bar and its drop-down use
  `--font`, match the `.menu` computed styles (background, radius, item height,
  highlight colour) and switch with the dark theme (`emulateMedia({ colorScheme })`).

## Branch `settings-modern` (worker) — PW_PORT 4441

The Settings window in the style of a modern macOS app's Settings (Preview or Safari
Settings on Sonoma):
- Window: `--radius-alert` corners, background `--chrome-bg`, `--menu-ring` and a large
  soft shadow, over `--scrim`. Title bar unified with the tab toolbar: centred pane name in
  13 px weight 600 `--text`; flat traffic lights at the top left (12 px circles; close red
  `#ff5f57` with a dark border, the other two greyed out and inert since the panel cannot
  minimise or zoom), no gloss.
- Tab toolbar: monochrome SF-Symbol-style line icons (about 22 px, `--icon`, stroke like
  `src/ui/icons.ts`) with an 11 px label under each: General = gear, Markup = pen tip or
  highlighter, Window = window (`macwindow`). Selected tab: rounded rect (radius 6 px)
  `--fill-pressed` behind icon and label, icon and label in `--accent`. Hover
  `--fill-hover`. A hairline under the toolbar.
- Panes: the existing layout (right-aligned labels, controls in a column, captions under
  them) in `--font` 13 px, captions 11 px `--text-secondary`, comfortable 10–12 px row gaps.
- Pop-up buttons: macOS style — `--control-bg`, `--control-shadow`, radius 5–6 px,
  22 px high, value on the left and, on the right, an `--accent` rounded square with white
  up/down chevrons. Their open list uses the `.menu` look (checked item marked, highlight
  `--accent-strong`). Keep the customizable `<select>` if it can be styled this way,
  otherwise any accessible equivalent.
- Check boxes: 14 px, radius 3.5 px; off `--control-bg` with `--control-shadow`; on
  `--accent` fill with a white check; disabled at reduced opacity.
- Colour swatches (Markup pane): circles like the markup toolbar's palette.
- Light and dark from the tokens. Focus rings `--focus-ring`.
- Update tests that assert Lion styles; add e2e for dark mode and the popup/checkbox look.

## Rules for both workers

- Read this document and the previous one; look at `src/ui/menu.ts`, `src/ui/dialog.ts`,
  `src/ui/about.ts`, `src/ui/icons.ts`, `src/toolbar/toolbar.ts` and their CSS first.
- `npm ci`; gates before every commit: `npx tsc --noEmit`, `npx vitest run`,
  `PW_PORT=<your port> npx playwright test` (full suite green). Never port 4173.
- Change only your own files and your own CSS section, plus the tests that assert the old
  look. Do not touch the other worker's section, `:root` tokens, behaviour code or
  persistence. Do not bump the version, build the exe, push or merge.
- Check the result in light and dark screenshots (Chromium with
  `--font-render-hinting=none`), side by side with an existing `.menu` and the toolbar, and
  fix what does not match.
- Commit with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  post progress with `orca worktree set --worktree active --comment "…" --json`; at the
  end set `--workspace-status in-review` and print a short summary with screenshot paths.
