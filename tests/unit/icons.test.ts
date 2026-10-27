import { describe, expect, test } from 'vitest';
import { settingsIcons } from '../../src/settings/icons';
import { icons } from '../../src/ui/icons';

const REQUIRED = [
  'sidebar',
  'zoomIn',
  'zoomOut',
  'rotateLeft',
  'rotateRight',
  'ellipsis',
  'search',
  'chevronUp',
  'chevronDown',
  'chevronLeft',
  'chevronRight',
  'closeSmall',
  'document',
  'checkmark',
  'xmarkCircleFill',
  'markup',
  'highlighter',
] as const;

const attr = (svg: string, name: string): string | null =>
  new RegExp(`^<svg[^>]*\\s${name}="([^"]*)"`).exec(svg)?.[1] ?? null;

describe('icons', () => {
  test.each(REQUIRED)('%s is an 18px currentColor svg hidden from assistive tech', (name) => {
    const svg = (icons as Record<string, string>)[name];
    expect(svg).toBeDefined();
    expect(svg!.startsWith('<svg')).toBe(true);
    expect(svg!.endsWith('</svg>')).toBe(true);
    expect(attr(svg!, 'width')).toBe('18');
    expect(attr(svg!, 'height')).toBe('18');
    expect(attr(svg!, 'aria-hidden')).toBe('true');
    expect(attr(svg!, 'fill')).toBe('none');
    expect(attr(svg!, 'stroke')).toBe('currentColor');
  });

  test.each(REQUIRED)('%s draws a 1.5px stroke with round caps and joins', (name) => {
    const svg = (icons as Record<string, string>)[name]!;
    const viewBox = attr(svg, 'viewBox')!.split(/\s+/).map(Number);
    const rendered = (Number(attr(svg, 'stroke-width')) * 18) / viewBox[2]!;
    expect(rendered).toBeCloseTo(1.5, 5);
    expect(viewBox[2]).toBe(viewBox[3]);
    expect(attr(svg, 'stroke-linecap')).toBe('round');
    expect(attr(svg, 'stroke-linejoin')).toBe('round');
  });

  test('every icon has its own drawing', () => {
    const bodies = Object.values(icons);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  test('the search clear glyph is a filled circle with the cross knocked out', () => {
    const svg = icons.xmarkCircleFill;
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('fill-rule="evenodd"');
  });
});

describe('Settings toolbar icons', () => {
  const entries = Object.entries(settingsIcons);

  test('there is one for each pane', () => {
    expect(Object.keys(settingsIcons).sort()).toEqual(['general', 'markup', 'window']);
  });

  test.each(entries)('%s is a 22px monochrome line icon like the app icons', (_, svg) => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(attr(svg, 'width')).toBe('22');
    expect(attr(svg, 'height')).toBe('22');
    expect(attr(svg, 'aria-hidden')).toBe('true');
    expect(attr(svg, 'fill')).toBe('none');
    expect(attr(svg, 'stroke')).toBe('currentColor');
    expect(attr(svg, 'stroke-linecap')).toBe('round');
    expect(attr(svg, 'stroke-linejoin')).toBe('round');
    const viewBox = attr(svg, 'viewBox')!.split(/\s+/).map(Number);
    expect(viewBox[2]).toBe(viewBox[3]);
    expect((Number(attr(svg, 'stroke-width')) * 22) / viewBox[2]!).toBeCloseTo(1.5, 1);
  });

  test.each(entries)('%s has no gradients, fixed colours or shared ids', (_, svg) => {
    expect(svg).not.toMatch(/Gradient|url\(#|\sid=|#[0-9a-f]{3,6}\b/i);
    for (const m of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)) expect(['none', 'currentColor']).toContain(m[1]);
  });

  test('every pane has its own drawing', () => {
    expect(new Set(Object.values(settingsIcons)).size).toBe(entries.length);
  });
});
