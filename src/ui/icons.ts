/** Inline 16px stroke icons (Fluent-like). All use currentColor. */
const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  sidebar: svg('<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M6 2.75v10.5"/>'),
  open: svg('<path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-10a1.5 1.5 0 0 1-1.5-1.5z"/>'),
  minus: svg('<path d="M3.5 8h9"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  rotate: svg('<path d="M12.5 6.5a5 5 0 1 0 .5 3"/><path d="M13 2.5v4h-4"/>'),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 13.5 13.5"/>'),
  chevronDown: svg('<path d="M4 6.5 8 10.5l4-4"/>'),
  chevronUp: svg('<path d="M4 9.5 8 5.5l4 4"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  check: svg('<path d="M3 8.5l3 3 7-7"/>'),
};
