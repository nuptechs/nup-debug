// ============================================================
// Notification Factory — build rules for the NotificationPort
// ============================================================

import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { NoopNotificationAdapter, WebhookNotificationAdapter } from '@probe/core';
import {
  buildNotificationPort,
  MIN_WEBHOOK_SECRET_LENGTH,
} from '../../src/lib/notification-factory.js';

const logger = pino({ level: 'silent' });
const STRONG_SECRET = 'x'.repeat(MIN_WEBHOOK_SECRET_LENGTH);

describe('buildNotificationPort', () => {
  it('returns Noop when url and secret are unset', () => {
    const { notification, store } = buildNotificationPort({
      url: undefined,
      secret: undefined,
      logger,
    });
    expect(notification).toBeInstanceOf(NoopNotificationAdapter);
    expect(notification.isConfigured()).toBe(false);
    expect(store).toBeNull();
  });

  it('returns Noop when only url is set', () => {
    const { notification } = buildNotificationPort({
      url: 'https://example.com/hook',
      secret: undefined,
      logger,
    });
    expect(notification).toBeInstanceOf(NoopNotificationAdapter);
  });

  it('throws in strict mode when env is missing', () => {
    expect(() =>
      buildNotificationPort({
        url: undefined,
        secret: undefined,
        logger,
        strict: true,
      }),
    ).toThrow(/required/);
  });

  it('rejects secrets below the minimum length', () => {
    expect(() =>
      buildNotificationPort({
        url: 'https://example.com/hook',
        secret: 'too-short',
        logger,
      }),
    ).toThrow(/WEBHOOK_SECRET must be at least/);
  });

  it('rejects internal / SSRF-suspicious URLs', () => {
    expect(() =>
      buildNotificationPort({
        url: 'http://127.0.0.1/hook',
        secret: STRONG_SECRET,
        logger,
      }),
    ).toThrow(/internal\/loopback\/metadata/);

    expect(() =>
      buildNotificationPort({
        url: 'http://169.254.169.254/latest/meta-data',
        secret: STRONG_SECRET,
        logger,
      }),
    ).toThrow(/internal\/loopback\/metadata/);
  });

  it('returns a configured WebhookNotificationAdapter when url+secret are valid', () => {
    const { notification, store } = buildNotificationPort({
      url: 'https://example.com/hook',
      secret: STRONG_SECRET,
      logger,
    });
    expect(notification).toBeInstanceOf(WebhookNotificationAdapter);
    expect(notification.isConfigured()).toBe(true);
    expect(store).not.toBeNull();
  });
});
