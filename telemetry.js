'use strict';

/**
 * telemetry.js — Experiment-comparison instrumentation.
 *
 * This module is entirely separate from any product telemetry the app might
 * have: it owns its own MeterProvider, its own periodic exporter, and its
 * own resource. It is never registered as the process's global
 * OpenTelemetry provider and never reads the standard OTEL_EXPORTER_OTLP_*
 * environment variables — everything is driven explicitly by the
 * MENDEL_METRICS_* / MENDEL_EXPERIMENT_* variables below.
 *
 * If those variables are missing or unreadable, this module becomes an
 * inert no-op: no metrics are recorded, no cookies are set, and nothing a
 * user could observe changes. Telemetry must never be able to break a
 * request or produce a user-visible error.
 *
 * Configuration (read once, at process start):
 *   MENDEL_METRICS_ENDPOINT    OTLP/HTTP (protobuf) metrics endpoint.
 *   MENDEL_METRICS_TOKEN       Sent as "Authorization: Bearer <token>".
 *   MENDEL_EXPERIMENT_ID       Identifies the experiment being served.
 *   MENDEL_EXPERIMENT_BUCKETS  Optional JSON array of { cookie, salt }.
 */

const crypto = require('crypto');

const DURATION_BOUNDARIES_MS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

// Counters whose events only happen in the browser (or, in versions of this
// app that don't have the feature at all, never happen). They are declared
// unconditionally below so the deployment always reports them, even at zero.
const CLIENT_EVENT_COUNTER_NAMES = ['game_over_shown', 'page_reload', 'play_again_click'];

const LONG_LIVED_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // ~400 days

function readConfig() {
  const endpoint     = process.env.MENDEL_METRICS_ENDPOINT;
  const token        = process.env.MENDEL_METRICS_TOKEN;
  const experimentId = process.env.MENDEL_EXPERIMENT_ID;

  let buckets = null;
  const rawBuckets = process.env.MENDEL_EXPERIMENT_BUCKETS;
  if (rawBuckets) {
    try {
      const parsed = JSON.parse(rawBuckets);
      if (Array.isArray(parsed)) {
        buckets = parsed
          .filter((b) => b && typeof b.cookie === 'string' && typeof b.salt === 'string')
          .map((b) => ({ cookie: b.cookie, salt: b.salt }));
      } else {
        buckets = null;
      }
    } catch (err) {
      buckets = null;
    }
  }

  return { endpoint, token, experimentId, buckets };
}

function parseCookies(req) {
  const jar    = {};
  const header = req.headers && req.headers.cookie;
  if (!header || typeof header !== 'string') return jar;

  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    const rawValue = part.slice(idx + 1).trim();
    try {
      jar[key] = decodeURIComponent(rawValue);
    } catch (err) {
      jar[key] = rawValue;
    }
  });

  return jar;
}

/**
 * HMAC-SHA256(salt, message) → first 8 bytes as a big-endian uint, mod
 * 1,000,000, formatted as 6 zero-padded digits.
 */
function computeAssignedBucketValue(salt, message) {
  const digest = crypto.createHmac('sha256', salt).update(message).digest();
  const num    = digest.readBigUInt64BE(0);
  return (num % 1000000n).toString().padStart(6, '0');
}

/**
 * SHA-256(value) → first 8 bytes as a big-endian uint, mod 100.
 */
function analysisBucketFromVisitorId(visitorId) {
  const digest = crypto.createHash('sha256').update(visitorId).digest();
  const num    = digest.readBigUInt64BE(0);
  return Number(num % 100n);
}

function createNoopTelemetry() {
  return {
    enabled: false,
    middleware(req, res, next) { next(); },
    recordClientEvent() { /* no-op: telemetry disabled */ },
  };
}

function buildResource(resources, instanceId) {
  if (typeof resources.resourceFromAttributes === 'function') {
    return resources.resourceFromAttributes({ 'service.instance.id': instanceId });
  }
  // Older SDK versions expose a Resource class instead of the factory fn.
  return new resources.Resource({ 'service.instance.id': instanceId });
}

function createTelemetry() {
  const { endpoint, token, experimentId, buckets } = readConfig();

  if (!endpoint || !token || !experimentId) {
    return createNoopTelemetry();
  }

  let meterProvider;
  let counters;
  let requestDuration;

  try {
    const {
      MeterProvider,
      PeriodicExportingMetricReader,
      View,
      ExplicitBucketHistogramAggregation,
      AggregationTemporality,
    } = require('@opentelemetry/sdk-metrics');
    const resources                = require('@opentelemetry/resources');
    const { OTLPMetricExporter }   = require('@opentelemetry/exporter-metrics-otlp-proto');

    const instanceId = crypto.randomUUID();

    const exporter = new OTLPMetricExporter({
      url: endpoint,
      headers: { Authorization: `Bearer ${token}` },
      temporalityPreference: AggregationTemporality.CUMULATIVE,
    });

    meterProvider = new MeterProvider({
      resource: buildResource(resources, instanceId),
      views: [
        new View({
          instrumentName: 'mendel_request_duration',
          aggregation: new ExplicitBucketHistogramAggregation(DURATION_BOUNDARIES_MS),
        }),
      ],
    });

    meterProvider.addMetricReader(new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60000,
    }));

    const meter = meterProvider.getMeter('pong-experiment-control');

    counters = {
      game_over_shown:      meter.createCounter('game_over_shown'),
      page_reload:          meter.createCounter('page_reload'),
      play_again_click:     meter.createCounter('play_again_click'),
      mendel_participants:  meter.createCounter('mendel_participants'),
      mendel_requests:      meter.createCounter('mendel_requests'),
      mendel_server_errors: meter.createCounter('mendel_server_errors'),
    };
    requestDuration = meter.createHistogram('mendel_request_duration');
  } catch (err) {
    // If OpenTelemetry isn't installed/usable, fall back to reporting
    // nothing rather than ever breaking the app.
    return createNoopTelemetry();
  }

  // Every declared counter is reported at 0, with no attributes, as soon as
  // the process starts — including counters for events this version of the
  // code can never produce.
  Object.keys(counters).forEach((name) => counters[name].add(0));

  function setLongLivedCookie(req, res, name, value) {
    res.cookie(name, value, {
      path:     '/',
      maxAge:   LONG_LIVED_COOKIE_MAX_AGE_MS,
      httpOnly: true,
      sameSite: 'lax',
      secure:   Boolean(req.secure),
    });
  }

  function getAssignmentKey(req) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.id) {
      return String(req.user.id);
    }
    return null;
  }

  function middleware(req, res, next) {
    const startNs = process.hrtime.bigint();
    let attributes = {};

    try {
      const cookies           = parseCookies(req);
      const bucketCookieNames = buckets ? buckets.map((b) => b.cookie) : [];

      // 2. Keep bucket-assignment cookies in sync when we know a stable
      //    participant identity, so assignment survives cookie loss.
      if (buckets && buckets.length > 0) {
        const assignmentKey = getAssignmentKey(req);
        if (assignmentKey) {
          buckets.forEach((entry) => {
            let value;
            try {
              value = computeAssignedBucketValue(entry.salt, assignmentKey);
            } catch (err) {
              return;
            }
            if (cookies[entry.cookie] !== value) {
              setLongLivedCookie(req, res, entry.cookie, value);
              cookies[entry.cookie] = value;
            }
          });
        }
      }

      // 1. Assignment.
      const assigned = Boolean(cookies.mendel_arm) ||
        bucketCookieNames.some((name) => cookies[name] !== undefined);

      // 3. Visitor cookie.
      if (!cookies.mendel_visitor) {
        const visitorId = crypto.randomUUID();
        setLongLivedCookie(req, res, 'mendel_visitor', visitorId);
        cookies.mendel_visitor = visitorId;
      }

      // 4. Analysis Bucket — only for assigned requests, never any other attribute.
      if (assigned) {
        let analysisBucket = null;

        const matchedBucketCookie = bucketCookieNames.find((name) => cookies[name] !== undefined);
        if (matchedBucketCookie) {
          const numeric = parseInt(cookies[matchedBucketCookie], 10);
          if (Number.isFinite(numeric)) {
            analysisBucket = ((numeric % 100) + 100) % 100;
          }
        }

        if (analysisBucket === null) {
          analysisBucket = analysisBucketFromVisitorId(cookies.mendel_visitor);
        }

        attributes = { mendel_analysis_bucket: analysisBucket };
      }

      // 5. Participants — once per experiment per participant.
      if (assigned) {
        const seenCookieName = `mendel_seen_${experimentId}`;
        if (!cookies[seenCookieName]) {
          counters.mendel_participants.add(1, attributes);
          setLongLivedCookie(req, res, seenCookieName, '1');
        }
      }
    } catch (err) {
      // Telemetry must never break a request.
      attributes = {};
    }

    req.mendelAttributes = attributes;

    res.once('finish', () => {
      try {
        counters.mendel_requests.add(1, attributes);

        const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
        requestDuration.record(durationMs, attributes);

        if (res.statusCode >= 500) {
          counters.mendel_server_errors.add(1, attributes);
        }
      } catch (err) {
        // Ignore — telemetry must never surface to the user.
      }
    });

    next();
  }

  function recordClientEvent(eventName, req) {
    if (!CLIENT_EVENT_COUNTER_NAMES.includes(eventName)) return;
    try {
      const attributes = (req && req.mendelAttributes) || {};
      counters[eventName].add(1, attributes);
    } catch (err) {
      // Ignore — telemetry must never surface to the user.
    }
  }

  return { enabled: true, middleware, recordClientEvent };
}

module.exports = createTelemetry();
