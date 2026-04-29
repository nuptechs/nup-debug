import { describe, it, expect } from 'vitest';
import { createTrafficFilter } from '../../src/filters/traffic-filter.js';
import type { NetworkConfig } from '@nuptechs-sentinel-probe/core';

function makeConfig(partial: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    enabled: true,
    mode: 'proxy',
    captureBody: false,
    ...partial,
  };
}

describe('createTrafficFilter', () => {
  describe('default (no include/exclude)', () => {
    it('allows any URL', () => {
      const filter = createTrafficFilter(makeConfig());
      expect(filter('https://example.com/api/v1')).toBe(true);
      expect(filter('http://localhost:3000')).toBe(true);
    });
  });

  describe('includeUrls', () => {
    it('allows only matching URLs', () => {
      const filter = createTrafficFilter(
        makeConfig({ includeUrls: ['https://api.example.com/*'] }),
      );
      expect(filter('https://api.example.com/users')).toBe(true);
      expect(filter('https://other.com/data')).toBe(false);
    });

    it('supports ** (any path depth)', () => {
      const filter = createTrafficFilter(
        makeConfig({ includeUrls: ['https://api.example.com/**'] }),
      );
      expect(filter('https://api.example.com/v1/users/123')).toBe(true);
      expect(filter('https://other.com/v1')).toBe(false);
    });

    it('matches case-insensitively', () => {
      const filter = createTrafficFilter(
        makeConfig({ includeUrls: ['https://API.EXAMPLE.COM/*'] }),
      );
      expect(filter('https://api.example.com/test')).toBe(true);
    });

    it('multiple include patterns → URL must match at least one', () => {
      const filter = createTrafficFilter(
        makeConfig({
          includeUrls: ['https://a.com/*', 'https://b.com/*'],
        }),
      );
      expect(filter('https://a.com/x')).toBe(true);
      expect(filter('https://b.com/y')).toBe(true);
      expect(filter('https://c.com/z')).toBe(false);
    });
  });

  describe('excludeUrls', () => {
    it('blocks matching URLs', () => {
      const filter = createTrafficFilter(
        makeConfig({ excludeUrls: ['https://internal.com/*'] }),
      );
      expect(filter('https://internal.com/health')).toBe(false);
      expect(filter('https://api.example.com/data')).toBe(true);
    });

    it('exclude takes priority over include for same URL', () => {
      const filter = createTrafficFilter(
        makeConfig({
          includeUrls: ['https://api.com/**'],
          excludeUrls: ['https://api.com/health'],
        }),
      );
      expect(filter('https://api.com/users')).toBe(true);
      expect(filter('https://api.com/health')).toBe(false);
    });
  });

  describe('excludeExtensions', () => {
    it('blocks URLs ending in excluded extensions', () => {
      const filter = createTrafficFilter(
        makeConfig({ excludeExtensions: ['.css', '.js', '.png'] }),
      );
      expect(filter('https://cdn.com/style.css')).toBe(false);
      expect(filter('https://cdn.com/app.js')).toBe(false);
      expect(filter('https://cdn.com/logo.png')).toBe(false);
      expect(filter('https://api.com/data')).toBe(true);
    });

    it('normalizes extensions without leading dot', () => {
      const filter = createTrafficFilter(
        makeConfig({ excludeExtensions: ['css', 'js'] }),
      );
      expect(filter('https://cdn.com/style.css')).toBe(false);
      expect(filter('https://cdn.com/app.js')).toBe(false);
    });

    it('is case-insensitive', () => {
      const filter = createTrafficFilter(
        makeConfig({ excludeExtensions: ['.PNG'] }),
      );
      expect(filter('https://cdn.com/image.png')).toBe(false);
    });

    it('ignores query strings after the extension', () => {
      const filter = createTrafficFilter(
        makeConfig({ excludeExtensions: ['.js'] }),
      );
      expect(filter('https://cdn.com/app.js?v=123')).toBe(false);
    });

    it('passes URLs without extensions', () => {
      const filter = createTrafficFilter(
        makeConfig({ excludeExtensions: ['.css'] }),
      );
      expect(filter('https://api.com/v1/users')).toBe(true);
    });
  });

  describe('glob edge cases', () => {
    it('? matches single non-slash char', () => {
      const filter = createTrafficFilter(
        makeConfig({ includeUrls: ['https://api.com/v?/users'] }),
      );
      expect(filter('https://api.com/v1/users')).toBe(true);
      expect(filter('https://api.com/v2/users')).toBe(true);
      expect(filter('https://api.com/v10/users')).toBe(false);
    });

    it('* does not match slashes', () => {
      const filter = createTrafficFilter(
        makeConfig({ includeUrls: ['https://api.com/*'] }),
      );
      expect(filter('https://api.com/users')).toBe(true);
      expect(filter('https://api.com/users/123')).toBe(false);
    });

    it('** matches across slashes', () => {
      const filter = createTrafficFilter(
        makeConfig({ includeUrls: ['https://api.com/**'] }),
      );
      expect(filter('https://api.com/a/b/c/d')).toBe(true);
    });

    it('escapes regex special chars in patterns', () => {
      const filter = createTrafficFilter(
        makeConfig({ includeUrls: ['https://api.example.com/v1/users'] }),
      );
      // The . in example.com and the path should be literal
      expect(filter('https://apiBexampleBcom/v1/users')).toBe(false);
    });
  });

  describe('relative/invalid URLs in extension filter', () => {
    it('handles relative URLs in extension extraction', () => {
      const filter = createTrafficFilter(
        makeConfig({ excludeExtensions: ['.css'] }),
      );
      expect(filter('/static/style.css')).toBe(false);
    });
  });
});
