import { describe, expect, test } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  clampZoom,
  formatZoom,
  wheelZoom,
  zoomIn,
  zoomOut,
} from '../../src/viewer/zoom';

describe('constants', () => {
  test('range is 10%–800%', () => {
    expect(ZOOM_MIN).toBe(0.1);
    expect(ZOOM_MAX).toBe(8);
  });

  test('steps are ascending and within range', () => {
    expect(ZOOM_STEPS).toEqual([
      0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
    ]);
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]!).toBeGreaterThan(ZOOM_STEPS[i - 1]!);
    }
    expect(ZOOM_STEPS[0]!).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]!).toBeLessThanOrEqual(ZOOM_MAX);
  });
});

describe('zoomIn', () => {
  test('moves to the next step from an exact step', () => {
    expect(zoomIn(1)).toBe(1.1);
  });

  test('moves to the next step from a value between steps', () => {
    expect(zoomIn(1.05)).toBe(1.1);
  });

  test('snaps to the first step from below the smallest step', () => {
    expect(zoomIn(0.1)).toBe(0.25);
  });

  test('stays at ZOOM_MAX at the top', () => {
    expect(zoomIn(8)).toBe(8);
    expect(zoomIn(7.9999999)).toBe(8);
  });
});

describe('zoomOut', () => {
  test('moves to the previous step from an exact step', () => {
    expect(zoomOut(1)).toBe(0.9);
  });

  test('moves to the previous step from a value between steps', () => {
    expect(zoomOut(1.05)).toBe(1);
  });

  test('stays at ZOOM_MIN at the bottom', () => {
    expect(zoomOut(0.1)).toBe(0.1);
    expect(zoomOut(0.25)).toBe(0.1);
  });
});

describe('clampZoom', () => {
  test('clamps into [ZOOM_MIN, ZOOM_MAX]', () => {
    expect(clampZoom(20)).toBe(8);
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe('formatZoom', () => {
  test('rounds to a whole percentage', () => {
    expect(formatZoom(1.333)).toBe('133%');
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.5)).toBe('50%');
    expect(formatZoom(0.675)).toBe('68%');
  });
});

describe('wheelZoom', () => {
  test('scrolling up (negative deltaY) zooms in by 1.1 per 100 units', () => {
    expect(wheelZoom(1, -100)).toBeCloseTo(1.1, 10);
  });

  test('scrolling down (positive deltaY) zooms out by 1/1.1 per 100 units', () => {
    expect(wheelZoom(1, 100)).toBeCloseTo(1 / 1.1, 10);
  });

  test('is smooth for small trackpad deltas', () => {
    expect(wheelZoom(1, -10)).toBeCloseTo(1.1 ** 0.1, 10);
    expect(wheelZoom(1, 0)).toBe(1);
  });

  test('clamps to the zoom range', () => {
    expect(wheelZoom(8, -100)).toBe(8);
    expect(wheelZoom(0.1, 100)).toBe(0.1);
  });
});
