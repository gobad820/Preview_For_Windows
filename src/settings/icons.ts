/**
 * 32 px toolbar icons for the Settings window, drawn in the glossy Mac OS X Lion manner
 * (gradients, a light top edge, a soft drop shadow). Original drawings on a 32-unit grid.
 * Gradient ids are prefixed so they never clash with the document; one window exists at a time.
 */
const svg = (body: string) =>
  `<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${body}</svg>`;

/** A light switch on a brushed plate (the classic General preference icon). */
const general = svg(`
  <defs>
    <linearGradient id="pfw-set-plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdfdfd"/><stop offset=".55" stop-color="#d9d9d9"/><stop offset="1" stop-color="#b9b9b9"/>
    </linearGradient>
    <linearGradient id="pfw-set-slot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a5a5a"/><stop offset="1" stop-color="#8c8c8c"/>
    </linearGradient>
    <linearGradient id="pfw-set-lever" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c4c4c4"/>
    </linearGradient>
  </defs>
  <rect x="5" y="2.5" width="22" height="28" rx="4" fill="#000" opacity=".18"/>
  <rect x="5" y="1.5" width="22" height="28" rx="4" fill="url(#pfw-set-plate)" stroke="#7d7d7d" stroke-width=".8"/>
  <rect x="5.8" y="2.2" width="20.4" height="1.2" rx=".6" fill="#fff" opacity=".9"/>
  <rect x="11.5" y="8" width="9" height="15" rx="2.2" fill="url(#pfw-set-slot)"/>
  <rect x="12.3" y="8.8" width="7.4" height="7.6" rx="1.6" fill="url(#pfw-set-lever)" stroke="#6f6f6f" stroke-width=".5"/>
  <rect x="12.9" y="9.3" width="6.2" height="1" rx=".5" fill="#fff"/>
  <circle cx="16" cy="5" r=".9" fill="#8a8a8a"/><circle cx="16" cy="26.2" r=".9" fill="#8a8a8a"/>
`);

/** A yellow pencil writing a stroke (markup defaults). */
const markup = svg(`
  <defs>
    <linearGradient id="pfw-set-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#f7c623"/><stop offset="1" stop-color="#d99a0b"/>
    </linearGradient>
    <linearGradient id="pfw-set-wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6dcb4"/><stop offset="1" stop-color="#c99a62"/>
    </linearGradient>
    <linearGradient id="pfw-set-eraser" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb3b8"/><stop offset="1" stop-color="#e2667a"/>
    </linearGradient>
  </defs>
  <path d="M3.5 28.5c4-2.6 7.2-2.8 10.6-1.4" fill="none" stroke="#2b58df" stroke-width="2" stroke-linecap="round"/>
  <g transform="rotate(45 16 16)">
    <rect x="13.4" y="2" width="6.2" height="22" rx="1" fill="#000" opacity=".16" transform="translate(.8 .9)"/>
    <rect x="13" y="1" width="6" height="3.6" rx="1.2" fill="url(#pfw-set-eraser)"/>
    <rect x="13" y="4.2" width="6" height="2.4" fill="#c6c9cf" stroke="#8d9097" stroke-width=".4"/>
    <rect x="13" y="6.6" width="6" height="15.4" fill="url(#pfw-set-body)" stroke="#b07a06" stroke-width=".4"/>
    <rect x="15.2" y="6.6" width="1.6" height="15.4" fill="#fff3b8" opacity=".55"/>
    <path d="M13 22h6l-3 6.2z" fill="url(#pfw-set-wood)" stroke="#a87d48" stroke-width=".4"/>
    <path d="M15.1 26.2h1.8L16 28.2z" fill="#333"/>
  </g>
`);

/** A window with a menu bar (window settings). */
const windowIcon = svg(`
  <defs>
    <linearGradient id="pfw-set-frame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ebebeb"/><stop offset="1" stop-color="#bdbdbd"/>
    </linearGradient>
    <linearGradient id="pfw-set-menubar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6f6f6"/><stop offset="1" stop-color="#d6d6d6"/>
    </linearGradient>
    <linearGradient id="pfw-set-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e4ecf7"/>
    </linearGradient>
  </defs>
  <rect x="2.5" y="5.5" width="27" height="23" rx="2.5" fill="#000" opacity=".18"/>
  <rect x="2.5" y="4.5" width="27" height="23" rx="2.5" fill="url(#pfw-set-frame)" stroke="#6e6e6e" stroke-width=".8"/>
  <circle cx="6" cy="7.6" r="1.25" fill="#ec5f55" stroke="#b5372d" stroke-width=".4"/>
  <circle cx="9.6" cy="7.6" r="1.25" fill="#f6bd3b" stroke="#c18a12" stroke-width=".4"/>
  <circle cx="13.2" cy="7.6" r="1.25" fill="#5fc454" stroke="#38912e" stroke-width=".4"/>
  <rect x="3.5" y="10.4" width="25" height="3.4" fill="url(#pfw-set-menubar)"/>
  <rect x="3.5" y="13.8" width="25" height=".6" fill="#8f8f8f"/>
  <rect x="5" y="11.5" width="2.6" height="1.2" rx=".4" fill="#222"/>
  <rect x="9" y="11.5" width="3.2" height="1.2" rx=".4" fill="#555"/>
  <rect x="13.4" y="11.5" width="3" height="1.2" rx=".4" fill="#555"/>
  <rect x="17.6" y="11.5" width="3.4" height="1.2" rx=".4" fill="#555"/>
  <rect x="3.5" y="14.4" width="25" height="12.1" rx="0" fill="url(#pfw-set-sky)"/>
  <rect x="7" y="16.4" width="7.6" height="8.2" rx=".6" fill="#fff" stroke="#b9b9b9" stroke-width=".5"/>
  <rect x="17.4" y="16.4" width="7.6" height="8.2" rx=".6" fill="#fff" stroke="#b9b9b9" stroke-width=".5"/>
`);

export const settingsIcons = { general, markup, window: windowIcon };
