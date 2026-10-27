import { describe, expect, test } from 'vitest';
import { AltTap, type TapKey } from '../../src/menubar/keys';

type Step = ['down' | 'up', Partial<TapKey> & { key: string }];

/** Feeds the steps in order; true when the last one completed an Alt tap. */
function play(steps: Step[], tap = new AltTap()): boolean[] {
  return steps.map(([type, k]) =>
    tap.feed(type, { code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, ...k }),
  );
}

const altDown: Step = ['down', { key: 'Alt', code: 'AltLeft', altKey: true }];
const altUp: Step = ['up', { key: 'Alt', code: 'AltLeft' }];

describe('AltTap', () => {
  test('left Alt pressed and released alone is a tap', () => {
    expect(play([altDown, altUp])).toEqual([false, true]);
  });

  test('holding Alt (auto-repeat) and releasing is still a tap', () => {
    const repeat: Step = ['down', { key: 'Alt', code: 'AltLeft', altKey: true, repeat: true }];
    expect(play([altDown, repeat, repeat, altUp]).at(-1)).toBe(true);
  });

  test('another key between press and release cancels it (Alt+F, Alt+Shift)', () => {
    expect(play([altDown, ['down', { key: 'f', code: 'KeyF', altKey: true }], ['up', { key: 'f', code: 'KeyF', altKey: true }], altUp]).at(-1)).toBe(false);
    expect(play([altDown, ['down', { key: 'Shift', code: 'ShiftLeft', altKey: true, shiftKey: true }], ['up', { key: 'Shift', code: 'ShiftLeft', altKey: true }], altUp]).at(-1)).toBe(false);
  });

  test('Ctrl+Alt+S is not a tap', () => {
    const steps: Step[] = [
      ['down', { key: 'Control', code: 'ControlLeft', ctrlKey: true }],
      ['down', { key: 'Alt', code: 'AltLeft', ctrlKey: true, altKey: true }],
      ['down', { key: 's', code: 'KeyS', ctrlKey: true, altKey: true }],
      ['up', { key: 's', code: 'KeyS', ctrlKey: true, altKey: true }],
      ['up', { key: 'Alt', code: 'AltLeft', ctrlKey: true }],
      ['up', { key: 'Control', code: 'ControlLeft' }],
    ];
    expect(play(steps)).not.toContain(true);
    // Ctrl released first, then Alt: still not a tap.
    expect(play([steps[0]!, steps[1]!, ['up', { key: 'Control', code: 'ControlLeft', altKey: true }], altUp])).not.toContain(true);
    // Alt tapped while Ctrl is held down.
    expect(play([steps[0]!, steps[1]!, ['up', { key: 'Alt', code: 'AltLeft', ctrlKey: true }]])).not.toContain(true);
  });

  test('AltGr (right Alt with a synthesized Ctrl) is not a tap', () => {
    const steps: Step[] = [
      ['down', { key: 'Control', code: 'ControlLeft', ctrlKey: true }],
      ['down', { key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true }],
      ['up', { key: 'Control', code: 'ControlLeft', altKey: true }],
      ['up', { key: 'AltGraph', code: 'AltRight' }],
    ];
    expect(play(steps)).not.toContain(true);
  });

  test('the Korean 한/영 key is not a tap, whichever way the keyboard reports it', () => {
    expect(play([['down', { key: 'HangulMode', code: 'Lang1' }], ['up', { key: 'HangulMode', code: 'Lang1' }]])).not.toContain(true);
    expect(play([['down', { key: 'HangulMode', code: 'AltRight' }], ['up', { key: 'HangulMode', code: 'AltRight' }]])).not.toContain(true);
    // 101-key compatible drivers send right Alt itself.
    expect(play([['down', { key: 'Alt', code: 'AltRight', altKey: true }], ['up', { key: 'Alt', code: 'AltRight' }]])).not.toContain(true);
  });

  test('a press during an IME composition is not a tap', () => {
    expect(play([['down', { key: 'Alt', code: 'AltLeft', altKey: true, isComposing: true }], altUp])).not.toContain(true);
  });

  test('reset() (a mouse press, the window losing focus) cancels a pending tap', () => {
    const tap = new AltTap();
    play([altDown], tap);
    tap.reset();
    expect(play([altUp], tap)).toEqual([false]);
    // The next clean press works again.
    expect(play([altDown, altUp], tap)).toEqual([false, true]);
  });
});
