// ============================================================
// RingBuffer — Property-based tests (fast-check)
//
// Invariants under any sequence of operations:
//   I1. size is always within [0, capacity]
//   I2. toArray() length always equals size
//   I3. push then shift n items returns them in FIFO order
//        (when no eviction occurred)
//   I4. when full, push(x) evicts exactly one item and returns it
//   I5. drain() empties the buffer and returns size-many items
//   I6. clear() resets to empty
//   I7. peek() agrees with toArray()[0]
//   I8. push of capacity+k items keeps only the last `capacity`
// ============================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RingBuffer } from '../../src/utils/ring-buffer.js';

const capacityArb = fc.integer({ min: 1, max: 32 });
const itemsArb = fc.array(fc.integer(), { maxLength: 200 });

describe('RingBuffer — property tests', () => {
  it('I1+I2: size in [0, capacity] and matches toArray length under random ops', () => {
    fc.assert(
      fc.property(
        capacityArb,
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant('push' as const), v: fc.integer() }),
            fc.record({ kind: fc.constant('shift' as const) }),
            fc.record({ kind: fc.constant('peek' as const) }),
            fc.record({ kind: fc.constant('clear' as const) }),
          ),
          { maxLength: 300 },
        ),
        (cap, ops) => {
          const buf = new RingBuffer<number>(cap);
          for (const op of ops) {
            if (op.kind === 'push') buf.push(op.v);
            else if (op.kind === 'shift') buf.shift();
            else if (op.kind === 'peek') buf.peek();
            else buf.clear();

            expect(buf.size).toBeGreaterThanOrEqual(0);
            expect(buf.size).toBeLessThanOrEqual(cap);
            expect(buf.toArray()).toHaveLength(buf.size);
            expect(buf.isEmpty).toBe(buf.size === 0);
            expect(buf.isFull).toBe(buf.size === cap);
          }
        },
      ),
    );
  });

  it('I3: push then shift returns FIFO order when no eviction', () => {
    fc.assert(
      fc.property(capacityArb, itemsArb, (cap, items) => {
        const fits = items.slice(0, cap);
        const buf = new RingBuffer<number>(cap);
        for (const v of fits) buf.push(v);
        const drained: number[] = [];
        while (!buf.isEmpty) drained.push(buf.shift() as number);
        expect(drained).toEqual(fits);
      }),
    );
  });

  it('I4: push when full evicts the FIFO-oldest item, simulated by a reference deque', () => {
    fc.assert(
      fc.property(capacityArb, itemsArb, (cap, items) => {
        const buf = new RingBuffer<number>(cap);
        const ref: number[] = [];
        for (const v of items) {
          const evicted = buf.push(v);
          ref.push(v);
          let expectedEvicted: number | undefined;
          if (ref.length > cap) expectedEvicted = ref.shift();
          expect(evicted).toBe(expectedEvicted);
          expect(buf.toArray()).toEqual(ref);
        }
        expect(buf.size).toBe(Math.min(items.length, cap));
      }),
    );
  });

  it('I5: drain empties buffer and returns insertion order', () => {
    fc.assert(
      fc.property(capacityArb, itemsArb, (cap, items) => {
        const buf = new RingBuffer<number>(cap);
        for (const v of items) buf.push(v);
        const expectedTail = items.slice(Math.max(0, items.length - cap));
        const drained = buf.drain();
        expect(drained).toEqual(expectedTail);
        expect(buf.size).toBe(0);
        expect(buf.isEmpty).toBe(true);
      }),
    );
  });

  it('I6: clear resets state regardless of fill', () => {
    fc.assert(
      fc.property(capacityArb, itemsArb, (cap, items) => {
        const buf = new RingBuffer<number>(cap);
        for (const v of items) buf.push(v);
        buf.clear();
        expect(buf.size).toBe(0);
        expect(buf.toArray()).toEqual([]);
        expect(buf.peek()).toBeUndefined();
        expect(buf.shift()).toBeUndefined();
      }),
    );
  });

  it('I7: peek matches toArray()[0] (or undefined when empty)', () => {
    fc.assert(
      fc.property(capacityArb, itemsArb, (cap, items) => {
        const buf = new RingBuffer<number>(cap);
        for (const v of items) {
          buf.push(v);
          const arr = buf.toArray();
          expect(buf.peek()).toBe(arr.length === 0 ? undefined : arr[0]);
        }
      }),
    );
  });

  it('I8: keeps only the last `capacity` items after overflow', () => {
    fc.assert(
      fc.property(capacityArb, itemsArb, (cap, items) => {
        const buf = new RingBuffer<number>(cap);
        for (const v of items) buf.push(v);
        const expected = items.slice(Math.max(0, items.length - cap));
        expect(buf.toArray()).toEqual(expected);
      }),
    );
  });

  it('rejects capacity < 1', () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (n) => {
        expect(() => new RingBuffer<number>(n)).toThrow(RangeError);
      }),
    );
  });
});
