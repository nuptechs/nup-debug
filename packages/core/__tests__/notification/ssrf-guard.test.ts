import { describe, it, expect } from 'vitest';
import { isPrivateIPv4, isInternalUrl } from '../../src/notification/ssrf-guard.js';

describe('isPrivateIPv4', () => {
  it('returns true for private ranges', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true);
    expect(isPrivateIPv4('172.16.5.1')).toBe(true);
    expect(isPrivateIPv4('172.31.255.254')).toBe(true);
    expect(isPrivateIPv4('192.168.1.1')).toBe(true);
    expect(isPrivateIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateIPv4('169.254.169.254')).toBe(true);
    expect(isPrivateIPv4('0.0.0.0')).toBe(true);
    expect(isPrivateIPv4('100.64.0.1')).toBe(true);
  });

  it('returns false for public addresses', () => {
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('1.1.1.1')).toBe(false);
    expect(isPrivateIPv4('172.32.0.1')).toBe(false);
    expect(isPrivateIPv4('192.169.0.1')).toBe(false);
    expect(isPrivateIPv4('100.63.0.1')).toBe(false);
  });

  it('returns false for invalid input', () => {
    expect(isPrivateIPv4('256.0.0.1')).toBe(false);
    expect(isPrivateIPv4('abc.def')).toBe(false);
    expect(isPrivateIPv4('')).toBe(false);
    expect(isPrivateIPv4('10.0.0')).toBe(false);
  });
});

describe('isInternalUrl', () => {
  it('blocks non-http schemes', () => {
    expect(isInternalUrl('file:///etc/passwd')).toBe(true);
    expect(isInternalUrl('ftp://example.com')).toBe(true);
    expect(isInternalUrl('gopher://example.com')).toBe(true);
  });

  it('blocks localhost forms', () => {
    expect(isInternalUrl('http://localhost/hook')).toBe(true);
    expect(isInternalUrl('http://127.0.0.1/hook')).toBe(true);
    expect(isInternalUrl('http://0.0.0.0/hook')).toBe(true);
  });

  it('blocks .local / .internal / .localhost TLDs', () => {
    expect(isInternalUrl('http://svc.local/hook')).toBe(true);
    expect(isInternalUrl('http://foo.internal/hook')).toBe(true);
    expect(isInternalUrl('http://bar.localhost/hook')).toBe(true);
  });

  it('blocks cloud metadata endpoints', () => {
    expect(isInternalUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
    expect(isInternalUrl('http://metadata.google.internal/')).toBe(true);
    expect(isInternalUrl('http://metadata.internal/')).toBe(true);
    expect(isInternalUrl('http://100.100.100.200/')).toBe(true);
  });

  it('blocks private IPv4 ranges', () => {
    expect(isInternalUrl('http://10.1.2.3/hook')).toBe(true);
    expect(isInternalUrl('https://192.168.1.1/hook')).toBe(true);
    expect(isInternalUrl('http://172.16.0.1/hook')).toBe(true);
  });

  it('blocks IPv6 loopback / ULA / link-local', () => {
    expect(isInternalUrl('http://[::1]/hook')).toBe(true);
    expect(isInternalUrl('http://[::]/hook')).toBe(true);
    expect(isInternalUrl('http://[fc00::1]/hook')).toBe(true);
    expect(isInternalUrl('http://[fd12:3456::1]/hook')).toBe(true);
    expect(isInternalUrl('http://[fe80::1]/hook')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 of private addresses', () => {
    expect(isInternalUrl('http://[::ffff:10.0.0.1]/hook')).toBe(true);
    expect(isInternalUrl('http://[::ffff:127.0.0.1]/hook')).toBe(true);
  });

  it('allows well-formed public URLs', () => {
    expect(isInternalUrl('https://api.example.com/hook')).toBe(false);
    expect(isInternalUrl('https://8.8.8.8/hook')).toBe(false);
    expect(isInternalUrl('https://hooks.slack.com/services/ABC/DEF/xyz')).toBe(false);
  });

  it('blocks malformed URLs', () => {
    expect(isInternalUrl('not a url')).toBe(true);
    expect(isInternalUrl('')).toBe(true);
  });
});
