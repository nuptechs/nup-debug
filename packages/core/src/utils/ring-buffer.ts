// ============================================================
// Ring Buffer — Bounded circular buffer with O(1) operations
// Prevents unbounded memory growth for event queues
// ============================================================

export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private tail: number = 0;
  private _size: number = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1) {
      throw new RangeError('RingBuffer capacity must be at least 1');
    }
    this.buffer = new Array(capacity);
  }

  /**
   * Add an item to the tail of the buffer.
   * If the buffer is full, the oldest item (head) is evicted and returned.
   */
  push(item: T): T | undefined {
    let evicted: T | undefined;

    if (this._size === this.capacity) {
      // Buffer full — evict oldest item at head
      evicted = this.buffer[this.head];
      this.buffer[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this._size--;
    }

    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this._size++;

    return evicted;
  }

  /** Peek at the oldest item without removing it. */
  peek(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buffer[this.head];
  }

  /** Remove and return the oldest item (head). */
  shift(): T | undefined {
    if (this._size === 0) return undefined;

    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this._size--;

    return item;
  }

  /** Remove all items, returning them in insertion order. */
  drain(): T[] {
    const items = this.toArray();
    this.clear();
    return items;
  }

  /** Snapshot of all items in insertion order (does not mutate). */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head + i) % this.capacity;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  get size(): number {
    return this._size;
  }

  get isFull(): boolean {
    return this._size === this.capacity;
  }

  get isEmpty(): boolean {
    return this._size === 0;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }
}
