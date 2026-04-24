// ============================================================
// DNS Rebinding Protection — resolveAndVerifyPublicHost()
// Verifies every resolved IP is checked against the private list,
// and that DNS-returned private IPs (rebinding attack) are blocked.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

// Import AFTER the mock is in place
const { resolveAndVerifyPublicHost } = await import('../../src/adapters/proxy.adapter.js');

describe('resolveAndVerifyPublicHost — DNS rebinding protection', () => {
  beforeEach(() => { lookupMock.mockReset(); });
  afterEach(() => { lookupMock.mockReset(); });

  it('blocks when hostname itself is private (localhost)', async () => {
    const r = await resolveAndVerifyPublicHost('localhost');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('blocked-hostname');
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('blocks when hostname resolves to a loopback IP (rebinding)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const r = await resolveAndVerifyPublicHost('evil.attacker.example');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('dns-resolves-to-private');
  });

  it('blocks when hostname resolves to cloud-metadata IP (169.254.169.254)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const r = await resolveAndVerifyPublicHost('attacker.example');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('dns-resolves-to-private');
  });

  it('blocks when ANY resolved IP is private (multi-record response)', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const r = await resolveAndVerifyPublicHost('mixed.example');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('dns-resolves-to-private');
  });

  it('allows when hostname resolves to a public IP and returns that IP', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    const r = await resolveAndVerifyPublicHost('dns.google');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.address).toBe('8.8.8.8');
      expect(r.family).toBe(4);
    }
  });

  it('skips DNS lookup when input is already a public IPv4 literal', async () => {
    const r = await resolveAndVerifyPublicHost('1.1.1.1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.address).toBe('1.1.1.1');
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('reports dns-empty when lookup returns []', async () => {
    lookupMock.mockResolvedValueOnce([]);
    const r = await resolveAndVerifyPublicHost('nxdomain.example');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('dns-empty');
  });

  it('reports dns-error when lookup throws (e.g. NXDOMAIN)', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const r = await resolveAndVerifyPublicHost('broken.example');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('dns-error');
  });

  it('blocks IPv6 ULA (fd00::/8) returned by DNS', async () => {
    lookupMock.mockResolvedValueOnce([{ address: 'fd12:3456:789a::1', family: 6 }]);
    const r = await resolveAndVerifyPublicHost('v6attacker.example');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('dns-resolves-to-private');
  });
});
