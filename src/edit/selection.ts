/**
 * Thumbnail selection over page ids, with Explorer/Finder click semantics.
 * `ids` is replaced (never mutated) on every change, so a set handed out
 * earlier stays a valid snapshot.
 */

export interface ClickMods {
  ctrl: boolean;
  shift: boolean;
}

/** Ids from `a` to `b` (inclusive, either direction) as they appear in `order`. */
function range(a: number, b: number, order: readonly number[]): number[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

export class Selection {
  private selected: ReadonlySet<number> = new Set();
  private anchorId: number | null = null;
  /** The id keyboard steps start from: the last clicked or stepped-to id. */
  private focusId: number | null = null;

  get ids(): ReadonlySet<number> {
    return this.selected;
  }

  get anchor(): number | null {
    return this.anchorId;
  }

  get focus(): number | null {
    return this.focusId;
  }

  get size(): number {
    return this.selected.size;
  }

  has(id: number): boolean {
    return this.selected.has(id);
  }

  /**
   * Plain: only `id`. Ctrl: toggle `id`. Shift: the range anchor..id replaces the
   * selection. Ctrl+Shift: the range is added. Ctrl and plain clicks move the anchor.
   */
  click(id: number, order: readonly number[], mods: ClickMods): void {
    if (mods.shift) {
      if (this.anchorId === null || !order.includes(this.anchorId)) this.anchorId = id;
      const r = range(this.anchorId, id, order);
      this.selected = new Set(mods.ctrl ? [...this.selected, ...r] : r);
      this.focusId = id;
      return;
    }
    if (mods.ctrl) {
      const next = new Set(this.selected);
      if (!next.delete(id)) next.add(id);
      this.selected = next;
      this.anchorId = this.focusId = id;
      return;
    }
    this.selectOnly(id);
  }

  selectOnly(id: number): void {
    this.selected = new Set([id]);
    this.anchorId = this.focusId = id;
  }

  /** Replaces the selection. The anchor defaults to the first id; steps continue from the last. */
  set(ids: Iterable<number>, anchor?: number): void {
    const list = [...ids];
    this.selected = new Set(list);
    this.anchorId = anchor ?? list[0] ?? null;
    this.focusId = anchor ?? list[list.length - 1] ?? null;
  }

  selectAll(order: readonly number[]): void {
    this.selected = new Set(order);
    this.anchorId = order[0] ?? null;
    this.focusId = order[order.length - 1] ?? null;
  }

  clear(): void {
    this.selected = new Set();
    this.anchorId = this.focusId = null;
  }

  /** Moves to the neighbour of the anchor/last-focused id; with `extend`, grows/shrinks the range. */
  step(dir: 1 | -1, order: readonly number[], extend: boolean): number | null {
    if (order.length === 0) return null;
    const from = this.stepOrigin(dir, order);
    if (from === null) {
      const first = (dir === 1 ? order[0] : order[order.length - 1])!;
      this.selectOnly(first);
      return first;
    }
    const i = order.indexOf(from) + dir;
    const to = order[Math.max(0, Math.min(order.length - 1, i))]!;
    if (!extend) {
      this.selectOnly(to);
      return to;
    }
    if (this.anchorId === null || !order.includes(this.anchorId)) this.anchorId = from;
    this.selected = new Set(range(this.anchorId, to, order));
    this.focusId = to;
    return to;
  }

  /** Drops ids no longer present; the anchor and focus are cleared when their page is gone. */
  prune(order: readonly number[]): void {
    const present = new Set(order);
    const kept = [...this.selected].filter((id) => present.has(id));
    if (kept.length !== this.selected.size) this.selected = new Set(kept);
    if (this.anchorId !== null && !present.has(this.anchorId)) this.anchorId = null;
    if (this.focusId !== null && !present.has(this.focusId)) this.focusId = null;
  }

  /** Focus, else anchor, else the selected page furthest in `dir`; null without a selection. */
  private stepOrigin(dir: 1 | -1, order: readonly number[]): number | null {
    if (this.focusId !== null && order.includes(this.focusId)) return this.focusId;
    if (this.anchorId !== null && order.includes(this.anchorId)) return this.anchorId;
    const selected = order.filter((id) => this.selected.has(id));
    return (dir === 1 ? selected[selected.length - 1] : selected[0]) ?? null;
  }
}
