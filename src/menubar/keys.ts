/** The parts of a KeyboardEvent the Alt-tap detector reads. */
export interface TapKey {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

/**
 * Windows menu-bar activation: left Alt pressed and released with no other key in between.
 * Right Alt never counts: it is AltGr on many layouts and 한/영 on Korean keyboards.
 */
export class AltTap {
  private armed = false;

  /** Feed every keydown and keyup; true on the keyup that completes a tap. */
  feed(type: 'down' | 'up', k: TapKey): boolean {
    const alt = k.key === 'Alt' && k.code !== 'AltRight';
    if (type === 'down') {
      if (alt && k.repeat) return false;
      this.armed = alt && !k.isComposing && !k.ctrlKey && !k.shiftKey && !k.metaKey;
      return false;
    }
    const tap = this.armed && alt;
    this.armed = false;
    return tap;
  }

  /** Cancels a pending tap (a mouse press, the window losing focus). */
  reset(): void {
    this.armed = false;
  }
}
