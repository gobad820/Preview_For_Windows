/**
 * Undo/redo over immutable snapshots. Tracks which entry was last saved, so
 * `dirty` follows undo and redo across a save. Entries are compared by
 * identity, never by value.
 */

interface Entry<T> {
  readonly value: T;
  /** Unique per entry and never reused, so a dropped saved entry stays unmatched. */
  readonly seq: number;
}

export class History<T> {
  private entries: Entry<T>[] = [];
  private pos = 0;
  private seq = 0;
  private savedSeq = 0;

  /** `limit` is the number of undo steps kept. */
  constructor(initial: T, private readonly limit = 200) {
    this.reset(initial);
  }

  get current(): T {
    return this.entries[this.pos]!.value;
  }

  get canUndo(): boolean {
    return this.pos > 0;
  }

  get canRedo(): boolean {
    return this.pos < this.entries.length - 1;
  }

  /** True when the current entry is not the one last saved (or opened). */
  get dirty(): boolean {
    return this.entries[this.pos]!.seq !== this.savedSeq;
  }

  /** Adds `next` after the current entry and clears redo. */
  push(next: T): void {
    this.entries.length = this.pos + 1;
    this.entries.push({ value: next, seq: ++this.seq });
    if (this.entries.length > this.limit + 1) this.entries.splice(0, this.entries.length - this.limit - 1);
    this.pos = this.entries.length - 1;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.pos--;
    return this.current;
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.pos++;
    return this.current;
  }

  markSaved(): void {
    this.savedSeq = this.entries[this.pos]!.seq;
  }

  /** Starts over for a new document: one clean entry, nothing to undo or redo. */
  reset(initial: T): void {
    this.entries = [{ value: initial, seq: ++this.seq }];
    this.pos = 0;
    this.markSaved();
  }
}
