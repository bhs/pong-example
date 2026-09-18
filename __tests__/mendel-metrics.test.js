'use strict';

/**
 * __tests__/mendel-metrics.test.js
 *
 * Unit tests for the pure helper functions in mendel-metrics.js (cookie
 * parsing/serialization, HMAC bucket computation, and the visitor-based
 * Analysis Bucket hash). Metrics reporting itself is disabled in the test
 * environment (no MENDEL_METRICS_ENDPOINT / _TOKEN / _EXPERIMENT_ID set),
 * so these tests avoid asserting anything about actual OTel export — only
 * that the module never throws and the middleware is a safe no-op.
 */

const {
  METRICS_ENABLED,
  DECLARED_METRICS,
  TRACKED_EVENT_NAMES,
  mendelMiddleware,
  incr,
  recordDuration,
  parseCookies,
  serializeCookie,
  computeBucket,
  analysisBucketFromVisitor,
} = require('../mendel-metrics');

// ── METRICS_ENABLED ─────────────────────────────────────────────────────────

describe('METRICS_ENABLED', () => {
  test('is false when MENDEL_METRICS_ENDPOINT / _TOKEN / _EXPERIMENT_ID are unset', () => {
    // The test process runs without these env vars configured.
    expect(METRICS_ENABLED).toBe(false);
  });
});

// ── DECLARED_METRICS ─────────────────────────────────────────────────────────

describe('DECLARED_METRICS', () => {
  test('declares exactly one primary and one guardrail metric', () => {
    const primaries   = DECLARED_METRICS.filter((m) => m.role === 'primary');
    const guardrails  = DECLARED_METRICS.filter((m) => m.role === 'guardrail');
    expect(primaries.length).toBe(1);
    expect(guardrails.length).toBe(1);
  });

  test('every metric has a valid better direction', () => {
    DECLARED_METRICS.forEach((m) => {
      expect(['higher', 'lower']).toContain(m.better);
    });
  });

  test('metric names are lower_snake_case and do not start with mendel_', () => {
    DECLARED_METRICS.forEach((m) => {
      expect(m.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(m.name.startsWith('mendel_')).toBe(false);
    });
  });

  test('includes the primary play_again_click / game_over_shown metric (higher is better)', () => {
    const primary = DECLARED_METRICS.find((m) => m.role === 'primary');
    expect(primary.name).toBe('play_again_click');
    expect(primary.per).toBe('game_over_shown');
    expect(primary.better).toBe('higher');
  });

  test('includes the guardrail page_reload / game_over_shown metric (lower is better)', () => {
    const guardrail = DECLARED_METRICS.find((m) => m.role === 'guardrail');
    expect(guardrail.name).toBe('page_reload');
    expect(guardrail.per).toBe('game_over_shown');
    expect(guardrail.better).toBe('lower');
  });
});

// ── TRACKED_EVENT_NAMES ──────────────────────────────────────────────────────

describe('TRACKED_EVENT_NAMES', () => {
  test('includes both declared metric names and their shared "per" denominator', () => {
    expect(TRACKED_EVENT_NAMES).toEqual(
      expect.arrayContaining(['play_again_click', 'page_reload', 'game_over_shown']),
    );
  });

  test('has no duplicate entries', () => {
    expect(new Set(TRACKED_EVENT_NAMES).size).toBe(TRACKED_EVENT_NAMES.length);
  });
});

// ── parseCookies ─────────────────────────────────────────────────────────────

describe('parseCookies', () => {
  test('parses a simple cookie header', () => {
    const cookies = parseCookies('a=1; b=2');
    expect(cookies).toEqual({ a: '1', b: '2' });
  });

  test('returns an empty object for an empty/undefined header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  test('decodes URI-encoded values', () => {
    const cookies = parseCookies('name=' + encodeURIComponent('hello world'));
    expect(cookies.name).toBe('hello world');
  });

  test('ignores malformed segments without an equals sign', () => {
    const cookies = parseCookies('a=1; garbage; b=2');
    expect(cookies).toEqual({ a: '1', b: '2' });
  });
});

// ── serializeCookie ──────────────────────────────────────────────────────────

describe('serializeCookie', () => {
  test('includes Path=/ and SameSite=Lax by default', () => {
    const str = serializeCookie('foo', 'bar');
    expect(str).toMatch(/^foo=bar; Path=\//);
    expect(str).toMatch(/SameSite=Lax/);
  });

  test('includes HttpOnly, Max-Age and Secure when requested', () => {
    const str = serializeCookie('foo', 'bar', { httpOnly: true, maxAgeSeconds: 100, secure: true });
    expect(str).toMatch(/HttpOnly/);
    expect(str).toMatch(/Max-Age=100/);
    expect(str).toMatch(/Secure/);
  });

  test('omits Secure when not requested', () => {
    const str = serializeCookie('foo', 'bar', {});
    expect(str).not.toMatch(/Secure/);
  });

  test('URI-encodes the value', () => {
    const str = serializeCookie('foo', 'hello world');
    expect(str).toMatch(/foo=hello%20world/);
  });
});

// ── computeBucket ────────────────────────────────────────────────────────────

describe('computeBucket', () => {
  test('returns a 6-digit zero-padded numeric string', () => {
    const bucket = computeBucket('some-salt', 'participant-123');
    expect(bucket).toMatch(/^\d{6}$/);
  });

  test('is deterministic for the same salt + key', () => {
    const b1 = computeBucket('salt', 'user-1');
    const b2 = computeBucket('salt', 'user-1');
    expect(b1).toBe(b2);
  });

  test('differs for different salts (per-experiment isolation)', () => {
    const b1 = computeBucket('salt-a', 'user-1');
    const b2 = computeBucket('salt-b', 'user-1');
    expect(b1).not.toBe(b2);
  });

  test('differs for different participant keys', () => {
    const b1 = computeBucket('salt', 'user-1');
    const b2 = computeBucket('salt', 'user-2');
    expect(b1).not.toBe(b2);
  });
});

// ── analysisBucketFromVisitor ────────────────────────────────────────────────

describe('analysisBucketFromVisitor', () => {
  test('returns an integer in [0, 100)', () => {
    for (let i = 0; i < 50; i++) {
      const bucket = analysisBucketFromVisitor(`visitor-${i}`);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  test('is deterministic for the same visitor id', () => {
    expect(analysisBucketFromVisitor('same-visitor')).toBe(analysisBucketFromVisitor('same-visitor'));
  });
});

// ── mendelMiddleware (disabled-mode safety) ─────────────────────────────────

describe('mendelMiddleware (metrics disabled in test env)', () => {
  function makeReqRes(cookieHeader) {
    const headers = {};
    const req = { method: 'GET', path: '/', headers: cookieHeader ? { cookie: cookieHeader } : {}, secure: false };
    const res = {
      locals: {},
      setHeader: (name, value) => { headers[name] = value; },
      on: (event, cb) => { if (event === 'finish') res._finishCb = cb; },
      statusCode: 200,
      _headers: headers,
    };
    return { req, res };
  }

  test('calls next() exactly once and never throws', () => {
    const { req, res } = makeReqRes();
    let nextCalls = 0;
    expect(() => mendelMiddleware(req, res, () => { nextCalls += 1; })).not.toThrow();
    expect(nextCalls).toBe(1);
  });

  test('does not set any cookie when metrics reporting is disabled', () => {
    const { req, res } = makeReqRes();
    mendelMiddleware(req, res, () => {});
    expect(res._headers['Set-Cookie']).toBeUndefined();
  });

  test('sets res.locals.mendelAttrs to an object', () => {
    const { req, res } = makeReqRes();
    mendelMiddleware(req, res, () => {});
    expect(typeof res.locals.mendelAttrs).toBe('object');
  });

  test('the finish handler does not throw even without export configured', () => {
    const { req, res } = makeReqRes();
    mendelMiddleware(req, res, () => {});
    expect(() => res._finishCb && res._finishCb()).not.toThrow();
  });
});

// ── incr / recordDuration (disabled-mode safety) ────────────────────────────

describe('incr / recordDuration (metrics disabled in test env)', () => {
  test('incr never throws for any tracked event name', () => {
    TRACKED_EVENT_NAMES.forEach((name) => {
      expect(() => incr(name, {})).not.toThrow();
    });
    expect(() => incr('does_not_exist')).not.toThrow();
  });

  test('recordDuration never throws', () => {
    expect(() => recordDuration(12.3, {})).not.toThrow();
  });
});
