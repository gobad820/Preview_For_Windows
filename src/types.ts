/** Shared primitive types used across viewer modules. Keep this file dependency-free. */

export type Rotation = 0 | 90 | 180 | 270;

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

/** Page size in PDF points (1/72 in), unrotated. */
export interface PageSize {
  width: number;
  height: number;
}
