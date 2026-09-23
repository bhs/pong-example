'use strict';

/**
 * __tests__/telemetry-nickname.test.js
 *
 * Smoke tests for the two server-side counters this hop's variation adds
 * to telemetry.js: 'nickname_set' (numerator) and 'user_login'
 * (denominator) — see .mendel/experiment.json's `metric`. With no
 * MENDEL_METRICS_* / MENDEL_EXPERIMENT_ID environment variables set (as in
 * this test run), telemetry.js is inert: recordServerEvent must be a
 * callable no-op that never throws, regardless of event name or request
 * shape.
 */

describe('telemetry.recordServerEvent (disabled/no-op mode)', () => {
  let telemetry;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.MENDEL_METRICS_ENDPOINT;
    delete process.env.MENDEL_METRICS_TOKEN;
    delete process.env.MENDEL_EXPERIMENT_ID;
    delete process.env.MENDEL_EXPERIMENT_BUCKETS;
    telemetry = require('../telemetry');
  });

  test('module reports disabled when unconfigured', () => {
    expect(telemetry.enabled).toBe(false);
  });

  test('exposes a recordServerEvent function', () => {
    expect(typeof telemetry.recordServerEvent).toBe('function');
  });

  test('recordServerEvent("user_login", req) never throws', () => {
    expect(() => telemetry.recordServerEvent('user_login', {})).not.toThrow();
  });

  test('recordServerEvent("nickname_set", req) never throws', () => {
    expect(() => telemetry.recordServerEvent('nickname_set', {})).not.toThrow();
  });

  test('recordServerEvent ignores unknown event names', () => {
    expect(() => telemetry.recordServerEvent('not_a_real_counter', {})).not.toThrow();
  });

  test('recordServerEvent tolerates a missing req argument', () => {
    expect(() => telemetry.recordServerEvent('user_login')).not.toThrow();
  });
});
