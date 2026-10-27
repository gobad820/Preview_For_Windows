/**
 * Settings toolbar icons: monochrome line drawings in the manner of SF Symbols, like the app's
 * own icons (src/ui/icons.ts). Original drawings on a 24-unit grid shown at 22px; the 1.65-unit
 * stroke renders at about 1.5px, the weight of the toolbar icons. All use currentColor.
 */
const svg = (body: string) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** General: a gear with eight teeth (gearshape). */
const general = svg(
  '<path d="M10.09 5.11L10.63 2.85A9.25 9.25 0 0 1 13.37 2.85L13.91 5.11A7.15 7.15 0 0 1 15.52 5.78L17.5 4.56' +
    'A9.25 9.25 0 0 1 19.44 6.5L18.22 8.48A7.15 7.15 0 0 1 18.89 10.09L21.15 10.63A9.25 9.25 0 0 1 21.15 13.37' +
    'L18.89 13.91A7.15 7.15 0 0 1 18.22 15.52L19.44 17.5A9.25 9.25 0 0 1 17.5 19.44L15.52 18.22' +
    'A7.15 7.15 0 0 1 13.91 18.89L13.37 21.15A9.25 9.25 0 0 1 10.63 21.15L10.09 18.89A7.15 7.15 0 0 1 8.48 18.22' +
    'L6.5 19.44A9.25 9.25 0 0 1 4.56 17.5L5.78 15.52A7.15 7.15 0 0 1 5.11 13.91L2.85 13.37' +
    'A9.25 9.25 0 0 1 2.85 10.63L5.11 10.09A7.15 7.15 0 0 1 5.78 8.48L4.56 6.5A9.25 9.25 0 0 1 6.5 4.56' +
    'L8.48 5.78A7.15 7.15 0 0 1 10.09 5.11Z"/>' +
    '<circle cx="12" cy="12" r="3"/>',
);

/** Markup: a sharpened pencil tip, the point up (pencil.tip). */
const markup = svg(
  '<path d="M12 2.75 16.75 14.5v6.25h-9.5V14.5Z"/>' +
    '<path d="M7.25 14.5q1.19 1.2 2.38 0q1.18 1.2 2.37 0q1.19 1.2 2.38 0q1.18 1.2 2.37 0"/>' +
    '<path d="M10.25 7.1h3.5"/>',
);

/** Window: a window with its title bar and traffic lights (macwindow). */
const windowIcon = svg(
  '<rect x="2.75" y="4.25" width="18.5" height="15.5" rx="3"/>' +
    '<path d="M2.75 8.75h18.5"/>' +
    '<path d="M5.6 6.5h.01M7.85 6.5h.01M10.1 6.5h.01" stroke-width="1.9"/>',
);

export const settingsIcons = { general, markup, window: windowIcon };

/** The pop-up button's up and down chevrons, drawn in currentColor on a 16px square. */
export const popupArrows =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<path d="M5.5 6.25 8 3.75l2.5 2.5M5.5 9.75 8 12.25l2.5-2.5"/></svg>';
