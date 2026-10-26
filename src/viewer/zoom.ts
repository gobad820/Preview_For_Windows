/** Pure zoom math. `scale` 1.0 means 100%. */

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;

/** Discrete stops for Ctrl+= / Ctrl+- and the zoom menu. Ascending, within [ZOOM_MIN, ZOOM_MAX]. */
export const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
];

/** Tolerance so a scale sitting exactly on a step moves to the next one. */
const EPSILON = 1e-6;

export function clampZoom(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** Smallest step strictly above `scale`, else ZOOM_MAX. */
export function zoomIn(scale: number): number {
  for (const step of ZOOM_STEPS) {
    if (step > scale + EPSILON) return step;
  }
  return ZOOM_MAX;
}

/** Largest step strictly below `scale`, else ZOOM_MIN. */
export function zoomOut(scale: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const step = ZOOM_STEPS[i]!;
    if (step < scale - EPSILON) return step;
  }
  return ZOOM_MIN;
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Multiplicative wheel zoom: ×1.1 per 100 units of upward (negative) deltaY, clamped. */
export function wheelZoom(scale: number, deltaY: number): number {
  return clampZoom(scale * 1.1 ** (-deltaY / 100));
}
