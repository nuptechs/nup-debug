// ============================================================
// SSRF Protection — isPrivateHost() comprehensive tests
// Verifies all private/internal IP ranges are blocked
// ============================================================

import { describe, it, expect } from 'vitest';
import { isPrivateHost } from '../../src/adapters/proxy.adapter.js';

describe('isPrivateHost — SSRF protection', () => {
  // ── Blocked: Loopback (127.x.x.x) ──

  describe('loopback 127.x.x.x', () => {
    it('blocks 127.0.0.1', () => expect(isPrivateHost('127.0.0.1')).toBe(true));
    it('blocks 127.0.0.2', () => expect(isPrivateHost('127.0.0.2')).toBe(true));
    it('blocks 127.255.255.255', () => expect(isPrivateHost('127.255.255.255')).toBe(true));
    it('blocks 127.1.2.3', () => expect(isPrivateHost('127.1.2.3')).toBe(true));
  });

  // ── Blocked: 10.x.x.x (Class A private) ──

  describe('10.x.x.x private range', () => {
    it('blocks 10.0.0.0', () => expect(isPrivateHost('10.0.0.0')).toBe(true));
    it('blocks 10.0.0.1', () => expect(isPrivateHost('10.0.0.1')).toBe(true));
    it('blocks 10.255.255.255', () => expect(isPrivateHost('10.255.255.255')).toBe(true));
    it('blocks 10.10.10.10', () => expect(isPrivateHost('10.10.10.10')).toBe(true));
  });

  // ── Blocked: 172.16.0.0/12 ──

  describe('172.16-31.x.x private range', () => {
    it('blocks 172.16.0.0', () => expect(isPrivateHost('172.16.0.0')).toBe(true));
    it('blocks 172.16.0.1', () => expect(isPrivateHost('172.16.0.1')).toBe(true));
    it('blocks 172.20.5.3', () => expect(isPrivateHost('172.20.5.3')).toBe(true));
    it('blocks 172.31.255.255', () => expect(isPrivateHost('172.31.255.255')).toBe(true));
    it('blocks 172.24.0.1', () => expect(isPrivateHost('172.24.0.1')).toBe(true));
    it('allows 172.15.0.1 (below range)', () => expect(isPrivateHost('172.15.0.1')).toBe(false));
    it('allows 172.32.0.1 (above range)', () => expect(isPrivateHost('172.32.0.1')).toBe(false));
  });

  // ── Blocked: 192.168.x.x ──

  describe('192.168.x.x private range', () => {
    it('blocks 192.168.0.1', () => expect(isPrivateHost('192.168.0.1')).toBe(true));
    it('blocks 192.168.1.1', () => expect(isPrivateHost('192.168.1.1')).toBe(true));
    it('blocks 192.168.255.255', () => expect(isPrivateHost('192.168.255.255')).toBe(true));
    it('allows 192.169.0.1 (outside range)', () => expect(isPrivateHost('192.169.0.1')).toBe(false));
    it('allows 192.167.0.1 (outside range)', () => expect(isPrivateHost('192.167.0.1')).toBe(false));
  });

  // ── Blocked: 169.254.x.x (link-local / cloud metadata) ──

  describe('169.254.x.x link-local / metadata', () => {
    it('blocks 169.254.0.1', () => expect(isPrivateHost('169.254.0.1')).toBe(true));
    it('blocks 169.254.169.254 (AWS metadata)', () => expect(isPrivateHost('169.254.169.254')).toBe(true));
    it('blocks 169.254.255.255', () => expect(isPrivateHost('169.254.255.255')).toBe(true));
    it('allows 169.255.0.1 (outside range)', () => expect(isPrivateHost('169.255.0.1')).toBe(false));
  });

  // ── Blocked: 0.x.x.x (current network) ──

  describe('0.x.x.x current network', () => {
    it('blocks 0.0.0.0', () => expect(isPrivateHost('0.0.0.0')).toBe(true));
    it('blocks 0.1.2.3', () => expect(isPrivateHost('0.1.2.3')).toBe(true));
  });

  // ── Blocked: 100.64-127.x.x (carrier-grade NAT) ──

  describe('100.64-127.x.x carrier-grade NAT', () => {
    it('blocks 100.64.0.1', () => expect(isPrivateHost('100.64.0.1')).toBe(true));
    it('blocks 100.100.0.1', () => expect(isPrivateHost('100.100.0.1')).toBe(true));
    it('blocks 100.127.255.255', () => expect(isPrivateHost('100.127.255.255')).toBe(true));
    it('allows 100.63.0.1 (below range)', () => expect(isPrivateHost('100.63.0.1')).toBe(false));
    it('allows 100.128.0.1 (above range)', () => expect(isPrivateHost('100.128.0.1')).toBe(false));
  });

  // ── Blocked: IPv6 ──

  describe('IPv6 blocked ranges', () => {
    it('blocks ::1 (IPv6 loopback)', () => expect(isPrivateHost('::1')).toBe(true));
    it('blocks fd00: (ULA)', () => expect(isPrivateHost('fd00:1234::1')).toBe(true));
    it('blocks fdab: (ULA)', () => expect(isPrivateHost('fdab:cdef:9876::1')).toBe(true));
    it('blocks fe80: (link-local)', () => expect(isPrivateHost('fe80::1')).toBe(true));
    it('blocks FE80: (case insensitive)', () => expect(isPrivateHost('FE80::1')).toBe(true));
    it('blocks FD00: (case insensitive ULA)', () => expect(isPrivateHost('FD00::1')).toBe(true));
  });

  // ── Blocked: special hostnames ──

  describe('special hostnames', () => {
    it('blocks localhost', () => expect(isPrivateHost('localhost')).toBe(true));
    it('blocks LOCALHOST (case insensitive)', () => expect(isPrivateHost('LOCALHOST')).toBe(true));
    it('blocks Localhost (mixed case)', () => expect(isPrivateHost('Localhost')).toBe(true));
    it('blocks empty string', () => expect(isPrivateHost('')).toBe(true));
  });

  // ── Allowed: public IPs ──

  describe('public IPs (allowed)', () => {
    it('allows 8.8.8.8 (Google DNS)', () => expect(isPrivateHost('8.8.8.8')).toBe(false));
    it('allows 1.1.1.1 (Cloudflare DNS)', () => expect(isPrivateHost('1.1.1.1')).toBe(false));
    it('allows 142.250.80.46 (Google)', () => expect(isPrivateHost('142.250.80.46')).toBe(false));
    it('allows 93.184.216.34 (example.com)', () => expect(isPrivateHost('93.184.216.34')).toBe(false));
    it('allows 203.0.113.1 (documentation range)', () => expect(isPrivateHost('203.0.113.1')).toBe(false));
    it('allows 44.0.0.1', () => expect(isPrivateHost('44.0.0.1')).toBe(false));
  });

  // ── Allowed: public hostnames ──

  describe('public hostnames (allowed)', () => {
    it('allows example.com', () => expect(isPrivateHost('example.com')).toBe(false));
    it('allows api.github.com', () => expect(isPrivateHost('api.github.com')).toBe(false));
    it('allows google.com', () => expect(isPrivateHost('google.com')).toBe(false));
    it('allows dashboard.probe.dev', () => expect(isPrivateHost('dashboard.probe.dev')).toBe(false));
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('blocks numeric loopback 127.0.0.1 without extra chars', () => {
      expect(isPrivateHost('127.0.0.1')).toBe(true);
    });
    it('does not false-positive on 128.0.0.1', () => {
      expect(isPrivateHost('128.0.0.1')).toBe(false);
    });
    it('does not false-positive on 11.0.0.1 (not 10.x)', () => {
      expect(isPrivateHost('11.0.0.1')).toBe(false);
    });
    it('does not false-positive on hostnames containing "localhost" as substring', () => {
      // "notlocalhost.com" should NOT match because lower === 'localhost' is strict
      expect(isPrivateHost('notlocalhost.com')).toBe(false);
    });
  });
});
