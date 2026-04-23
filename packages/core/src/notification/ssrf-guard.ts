// ============================================================
// SSRF Guard — Blocks webhooks targeting private/internal hosts
// Mirrors hardening from Sentinel webhook delivery.
// ============================================================

/**
 * Returns true if the IPv4 address is in a private / loopback / link-local / test range.
 * Accepts only dotted-quad form.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;               // 0.0.0.0/8
  if (a === 10) return true;              // 10.0.0.0/8
  if (a === 127) return true;             // loopback
  if (a === 169 && b === 254) return true; // link-local (includes cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b === 64) return true;  // 100.64.0.0/10 carrier-grade NAT (Alibaba metadata)
  return false;
}

/**
 * Returns true if the URL targets a host that should never receive outbound webhooks:
 * - non-http(s) schemes
 * - loopback / private / link-local IPs
 * - .local / .internal / .localhost TLDs
 * - IPv6 loopback, ULA (fc00::/7), link-local (fe80::/10), unspecified (::)
 * - cloud instance metadata hostnames (AWS, GCP, Azure, Alibaba)
 */
export function isInternalUrl(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return true;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) return true;

  // Explicit localhost forms
  if (host === 'localhost' || host === '0.0.0.0') return true;

  // Dotted TLD blocks
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return true;
  }

  // Cloud metadata hostnames
  if (
    host === 'metadata.google.internal' ||
    host === 'metadata.internal' ||
    host === '169.254.169.254' ||
    host === '100.100.100.200'
  ) {
    return true;
  }

  // IPv4 private
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) && isPrivateIPv4(host)) {
    return true;
  }

  // IPv6 — strip brackets if present (URL.hostname returns unbracketed already)
  const stripped = host.startsWith('[') ? host.slice(1, -1) : host;
  if (stripped.includes(':')) {
    // Unspecified / loopback
    if (stripped === '::' || stripped === '::1' || stripped === '0:0:0:0:0:0:0:0' || stripped === '0:0:0:0:0:0:0:1') {
      return true;
    }
    // Unique Local Addresses fc00::/7 (fc* or fd*)
    if (/^f[cd][0-9a-f]{2}:/i.test(stripped)) return true;
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/i.test(stripped)) return true;
    // IPv4-mapped IPv6 ::ffff:* — block unconditionally; IPv4 form of the address
    // should be used if the target is genuinely public, and Node normalises the
    // mapped form to compressed hex (e.g. ::ffff:a00:1) which bypasses dotted checks.
    if (/^::ffff:/i.test(stripped)) return true;
  }

  return false;
}
