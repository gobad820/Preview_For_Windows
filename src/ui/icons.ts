/**
 * Inline stroke icons in the spirit of SF Symbols (regular weight). Original drawings on a
 * 24-unit grid shown at 18px, so the 2-unit stroke renders as 1.5px. All use currentColor.
 */
const svg = (body: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** Filled shapes inside a stroked icon. */
const solid = (d: string) => `<path fill="currentColor" stroke="none" fill-rule="evenodd" d="${d}"/>`;

const LENS = '<circle cx="10.5" cy="10.5" r="6.75"/><path d="m15.5 15.5 5 5"/>';

export const icons = {
  sidebar: svg('<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15"/><path d="M5.9 8.5h1.2M5.9 11.5h1.2"/>'),
  zoomIn: svg(`${LENS}<path d="M7.75 10.5h5.5M10.5 7.75v5.5"/>`),
  zoomOut: svg(`${LENS}<path d="M7.75 10.5h5.5"/>`),
  rotateLeft: svg('<rect x="4" y="11" width="10" height="10" rx="2"/><path d="M19.5 15V12a6 6 0 0 0-6-6H8.5"/><path d="m11 3.5-2.5 2.5L11 8.5"/>'),
  rotateRight: svg('<rect x="10" y="11" width="10" height="10" rx="2"/><path d="M4.5 15V12a6 6 0 0 1 6-6h5"/><path d="m13 3.5 2.5 2.5L13 8.5"/>'),
  ellipsis: svg(
    '<circle cx="12" cy="12" r="9"/>' +
      solid('M8 10.8a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4ZM12 10.8a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4ZM16 10.8a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4Z'),
  ),
  search: svg(LENS),
  /** Markup toolbar: a pen nib in a circle (Preview's pencil.tip.crop.circle). */
  markup: svg('<circle cx="12" cy="12" r="9"/><path d="M9.25 16.5 12 7.25l2.75 9.25"/><path d="M10.35 13.25h3.3"/>'),
  /** Highlight: a slanted marker. */
  highlighter: svg('<path d="m13.75 5.25 5 5-7.5 7.5-3.25.75-2.5-2.5.75-3.25Z"/><path d="m11.25 7.75 5 5"/><path d="m6.5 16-2 2"/>'),
  /** Markup toolbar: Text Selection (an I-beam). */
  textCursor: svg('<path d="M8.5 4.5c2.25 0 3.5.75 3.5 2.25v10.5c0 1.5-1.25 2.25-3.5 2.25M15.5 4.5c-2.25 0-3.5.75-3.5 2.25v10.5c0 1.5 1.25 2.25 3.5 2.25M9.75 12h4.5"/>'),
  /** Draw: a pencil. */
  pencil: svg('<path d="m15.25 4.75 4 4L9 19l-4.75 1 1-4.75Z"/><path d="m12.75 7.25 4 4"/>'),
  /** Shapes: a square overlapping a circle. */
  shapes: svg('<rect x="3.5" y="3.5" width="10.5" height="10.5" rx="1.75"/><path d="M14 9.6a5.75 5.75 0 1 1-4.4 4.4"/>'),
  /** Text box: a T in a box. */
  textBox: svg('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M8.25 8.75h7.5M12 8.75v7.5"/>'),
  /** Note: a sticky note with a folded corner. */
  note: svg('<path d="M5.5 4h13a1.5 1.5 0 0 1 1.5 1.5v8.75L14.25 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4Z"/><path d="M20 14.25h-4.25a1.5 1.5 0 0 0-1.5 1.5V20"/><path d="M8 8.5h8M8 12h5"/>'),
  /** Line Width: three lines of growing weight. */
  lineWidth: svg('<path d="M4 6.5h16" stroke-width="1"/><path d="M4 11.75h16" stroke-width="2"/><path d="M4 17.5h16" stroke-width="3.5"/>'),
  /** Border Color: a square outline painted with `--swatch`. */
  borderColor: svg(
    '<rect x="5" y="5" width="14" height="14" rx="2.5" style="stroke: var(--swatch, currentColor)" stroke-width="3.5"/>' +
      '<rect x="2.75" y="2.75" width="18.5" height="18.5" rx="4.5" stroke-width="0.6" stroke-opacity="0.35"/>',
  ),
  /** Fill Color: a square filled with `--swatch`; the slash shows for No Fill. */
  fillColor: svg(
    '<rect x="4" y="4" width="16" height="16" rx="3" style="fill: var(--swatch, transparent)" stroke-width="1.5"/>' +
      '<path class="mk-nofill" d="M5.5 18.5 18.5 5.5" style="stroke: #ff3b30"/>',
  ),
  /** Text Style: "Aa". */
  textStyle: svg('<path d="M3 18.5 7.75 5.5l4.75 13M4.75 14h6"/><path d="M20.5 11.5v7M20.5 15a2.75 3 0 1 1-5.5 0a2.75 3 0 1 1 5.5 0Z"/>'),
  shapeLine: svg('<path d="M5 19 19 5"/>'),
  shapeArrow: svg('<path d="M5 19 18.5 5.5M10.5 5h8.5v8.5"/>'),
  shapeRect: svg('<rect x="3.5" y="6" width="17" height="12"/>'),
  shapeRounded: svg('<rect x="3.5" y="6" width="17" height="12" rx="4"/>'),
  shapeOval: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.25"/>'),
  chevronUp: svg('<path d="m6.5 14.75 5.5-5.5 5.5 5.5"/>'),
  chevronDown: svg('<path d="m6.5 9.25 5.5 5.5 5.5-5.5"/>'),
  chevronLeft: svg('<path d="m14.75 6.5-5.5 5.5 5.5 5.5"/>'),
  chevronRight: svg('<path d="m9.25 6.5 5.5 5.5-5.5 5.5"/>'),
  closeSmall: svg('<path d="m7.5 7.5 9 9M16.5 7.5l-9 9"/>'),
  document: svg('<path d="M7.5 3H13l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3Z"/><path d="M13 3v5h5"/>'),
  checkmark: svg('<path d="m5.5 12.5 4.5 4.5 8.5-10"/>'),
  xmarkCircleFill: svg(
    solid(
      'M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19Z' +
        'M12 10.59 14.79 7.79 16.21 9.21 13.41 12 16.21 14.79 14.79 16.21 12 13.41 9.21 16.21 7.79 14.79 10.59 12 7.79 9.21 9.21 7.79Z',
    ),
  ),
};
