// ============================================================
// Ring Buffer — Comprehensive tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/utils/ring-buffer.js';

describe('RingBuffer', () => {
  describe('constructor', () => {
    it('creates buffer with given capacity', () => {
      const buf = new RingBuffer<number>(5);
      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
      expect(buf.isFull).toBe(false);
    });

    it('throws on capacity < 1', () => {
      expect(() => new RingBuffer(0)).toThrow(RangeError);
      expect(() => new RingBuffer(-1)).toThrow(RangeError);
    });

    it('works with capacity of 1', () => {
      const buf = new RingBuffer<string>(1);
      buf.push('a');
      expect(buf.size).toBe(1);
      expect(buf.isFull).toBe(true);
    });
  });

  describe('push', () => {
    it('returns undefined when buffer is not full', () => {
      const buf = new RingBuffer<number>(3);
      expect(buf.push(1)).toBeUndefined();
      expect(buf.push(2)).toBeUndefined();
      expect(buf.push(3)).toBeUndefined();
    });

    it('evicts and returns oldest item when full', () => {
      const buf = new RingBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      expect(buf.push(4)).toBe(1);
      expect(buf.push(5)).toBe(2);
    });

    it('maintains correct size after evictions', () => {
      const buf = new RingBuffer<number>(2);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      expect(buf.size).toBe(2);
      expect(buf.toArray()).toEqual([2, 3]);
    });
  });

  describe('peek', () => {
    it('returns undefined on empty buffer', () => {
      const buf = new RingBuffer<number>(3);
      expect(buf.peek()).toBeUndefined();
    });

    it('returns oldest item without removing it', () => {
      const buf = new RingBuffer<number>(3);
      buf.push(10);
      buf.push(20);
      expect(buf.peek()).toBe(10);
      expect(buf.size).toBe(2);
    });
  });

  describe('shift', () => {
    it('returns undefined on empty buffer', () => {
      const buf = new RingBuffer<number>(3);
      expect(buf.shift()).toBeUndefined();
    });

    it('removes and returns oldest item', () => {
      const buf = new RingBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      expect(buf.shift()).toBe(1);
      expect(buf.shift()).toBe(2);
      expect(buf.size).toBe(1);
    });

    it('allows new pushes after shift', () => {
      const buf = new RingBuffer<number>(2);
      buf.push(1);
      buf.push(2);
      buf.shift();
      buf.push(3);
      expect(buf.toArray()).toEqual([2, 3]);
    });
  });

  describe('drain', () => {
    it('returns empty array on empty buffer', () => {
      const buf = new RingBuffer<number>(3);
      expect(buf.drain()).toEqual([]);
    });

    it('returns all items in order and clears buffer', () => {
      const buf = new RingBuffer<number>(5);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      const items = buf.drain();
      expect(items).toEqual([1, 2, 3]);
      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
    });
  });

  describe('toArray', () => {
    it('preserves insertion order', () => {
      const buf = new RingBuffer<number>(5);
      buf.push(10);
      buf.push(20);
      buf.push(30);
      expect(buf.toArray()).toEqual([10, 20, 30]);
    });

    it('preserves order after wrap-around', () => {
      const buf = new RingBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      buf.push(4); // evicts 1
      buf.push(5); // evicts 2
      expect(buf.toArray()).toEqual([3, 4, 5]);
    });

    it('does not mutate the buffer', () => {
      const buf = new RingBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.toArray();
      expect(buf.size).toBe(2);
    });
  });

  describe('clear', () => {
    it('resets buffer to empty state', () => {
      const buf = new RingBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.clear();
      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
      expect(buf.peek()).toBeUndefined();
    });
  });

  describe('stress test', () => {
    it('handles 100k pushes correctly', () => {
      const buf = new RingBuffer<number>(100);
      for (let i = 0; i < 100_000; i++) {
        buf.push(i);
      }
      expect(buf.size).toBe(100);
      const arr = buf.toArray();
      expect(arr[0]).toBe(99_900);
      expect(arr[99]).toBe(99_999);
    });
  });
});
