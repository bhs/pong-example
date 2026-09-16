'use strict';

/**
 * metrics.js — Isolated OpenTelemetry instrumentation for the Mendel
 * live-traffic experiment on the 'game-customization-options' hop
 * (dom-settings-panel variation).
 *
 * This module is completely separate from any telemetry the application
 * might otherwise have: its own MeterProvider, its own periodic reader,
 * its own OTLP/protobuf exporter. It is never registered as the global
 * MeterProvider and never reads OTEL_EXPORTER_OTLP_* env vars.
 *
 * Configuration (all read explicitly from the environment):
 *   MENDEL_METRICS_ENDPOINT   - OTLP/HTTP protobuf metrics endpoint.
 *   MENDEL_METRICS_TOKEN      - sent as `Authorization: Bearer <token>`.
 *   MENDEL_EXPERIMENT_ID      - the experiment being served.
 *   MENDEL_EXPERIMENT_BUCKETS - JSON list of {cookie, salt}; only present
 *                               for experiments that assign by bucket.
 *
 * If the endpoint, token, or experiment id is missing/unreadable, this
 * module reports nothing and sets no cookies at all — and never throws or
 * logs anything a user would notice.
 */

const crypto = require('crypto');

const MENDEL_METRICS_ENDPOINT   = process.env.MENDEL_METRICS_ENDPOINT;
const MENDEL_METRICS_TOKEN      = process.env.MENDEL_METRICS_TOKEN;
const MENDEL_EXPERIMENT_ID      = process.env.MENDEL_EXPERIMENT_ID;
const MENDEL_EXPERIMENT_BUCKETS = process.env.MENDEL_EXPERIMENT_BUCKETS;

const ENABLED = Boolean(MENDEL_METRICS_ENDPOINT && MENDEL_METRICS_TOKEN && MENDEL_EXPERIMENT_ID);

// Declared experiment metrics (same across every variation of this hop).
//   settings_changed / page_view  — primary: did the panel get used more?
//   game_completed   / page_view  — guardrail: people still finish games.
const DECLARED_COUNTERS = ['page_view', 'settings_changed', 'game_completed'];

const REQUEST_DURATION_BOUNDARIES =
  [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // ~400 days

let buckets = [];
if (ENABLED && MENDEL_EXPERIMENT_BUCKETS) {
  try {
    const parsed = JSON.parse(MENDEL_EXPERIMENT_BUCKETS);
    if (Array.isArray(parsed)) {
      buckets = parsed.filter((b) => b && typeof b.cookie === 'string' && typeof b.salt === 'string');
    }
  } catch (err) {
    buckets = []; // unreadable bucket list → set no bucket cookie
  }
}

let meterProvider = null;
let counters = {};
let requestDurationHistogram = null;

/**
 * Lazily set up the isolated MeterProvider + exporter + reader, and
 * zero-initialise every counter (declared metrics included) so the
 * deployment reports each one even where its event can't happen yet.
 * No-ops entirely when instrumentation is disabled.
 */
function setup() {
  if (!ENABLED || meterProvider) return;

  const { MeterProvider, PeriodicExportingMetricReader, View, ExplicitBucketHistogramAggregation, AggregationTemporality } =
    require('@opentelemetry/sdk-metrics');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
  const { Resource } = require('@opentelemetry/resources');

  const resource = Resource.default().merge(new Resource({
    'service.name':        'pong-game',
    'service.instance.id': crypto.randomUUID(),
  }));

  const exporter = new OTLPMetricExporter({
    url:     MENDEL_METRICS_ENDPOINT,
    headers: { Authorization: `Bearer ${MENDEL_METRICS_TOKEN}` },
    temporalityPreference: AggregationTemporality.CUMULATIVE,
  });

  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60000,
  });

  const durationView = new View({
    instrumentName: 'mendel_request_duration',
    aggregation: new ExplicitBucketHistogramAggregation(REQUEST_DURATION_BOUNDARIES),
  });

  meterProvider = new MeterProvider({ resource, readers: [reader], views: [durationView] });

  const meter = meterProvider.getMeter('pong-game-settings-experiment');

  counters.mendel_requests      = meter.createCounter('mendel_requests');
  counters.mendel_participants  = meter.createCounter('mendel_participants');
  counters.mendel_server_errors = meter.createCounter('mendel_server_errors');

  DECLARED_COUNTERS.forEach((name) => {
    counters[name] = meter.createCounter(name);
  });

  requestDurationHistogram = meter.createHistogram('mendel_request_duration');

  // Zero-init every counter (declared + built-in) with no attributes.
  Object.values(counters).forEach((counter) => counter.add(0));
}

setup();

// ── Cookie helpers ──────────────────────────────────────────────────────────

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function buildSetCookie(name, value, req) {
  const secure = Boolean(req.secure || req.protocol === 'https');
  let str = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`;
  if (secure) str += '; Secure';
  return str;
}

function bigUintFromBuffer(buf) {
  return buf.readBigUInt64BE(0);
}

/**
 * HMAC-SHA256(salt, participantKey) → first 8 bytes as big-endian uint,
 * modulo 1000000, zero-padded to 6 digits.
 */
function computeBucketValue(salt, participantKey) {
  const digest = crypto.createHmac('sha256', salt).update(participantKey).digest();
  const num = bigUintFromBuffer(digest) % 1000000n;
  return num.toString().padStart(6, '0');
}

/**
 * SHA-256(visitorId) → first 8 bytes as big-endian uint, modulo 100.
 */
function analysisBucketFromVisitor(visitorId) {
  const digest = crypto.createHash('sha256').update(visitorId).digest();
  return Number(bigUintFromBuffer(digest) % 100n);
}

/**
 * Best-effort application-specific participant key for bucket assignment
 * (only used when MENDEL_EXPERIMENT_BUCKETS is configured). This app's
 * authenticated identity — when present — comes from the Google OAuth
 * session established in server.js.
 */
function getParticipantKey(req) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return req.user.email || req.user.id || null;
  }
  return null;
}

// ── Express middleware ──────────────────────────────────────────────────────

/**
 * Attaches req.mendelAssigned / req.mendelAnalysisBucket for downstream
 * route handlers, sets the visitor/bucket/participant cookies as needed,
 * and records mendel_requests / mendel_request_duration / mendel_server_errors
 * on response finish. A pure no-op (calls next() immediately) when
 * instrumentation is disabled.
 */
function mendelMetricsMiddleware(req, res, next) {
  if (!ENABLED) return next();

  const startedAt = Date.now();
  const cookies = parseCookies(req.headers.cookie);
  const setCookies = [];

  let assigned = Boolean(cookies.mendel_arm);

  // Bucket-based assignment (only relevant if MENDEL_EXPERIMENT_BUCKETS set).
  if (buckets.length > 0) {
    const participantKey = getParticipantKey(req);
    buckets.forEach((entry) => {
      if (cookies[entry.cookie] !== undefined) {
        assigned = true;
      } else if (participantKey) {
        const computed = computeBucketValue(entry.salt, participantKey);
        setCookies.push(buildSetCookie(entry.cookie, computed, req));
        cookies[entry.cookie] = computed;
        assigned = true;
      }
    });
  }

  // Visitor cookie (used to derive the analysis bucket for unassigned-cookie
  // fallback, and to identify unique participants generally).
  let visitorId = cookies.mendel_visitor;
  if (!visitorId) {
    visitorId = crypto.randomBytes(16).toString('hex');
    setCookies.push(buildSetCookie('mendel_visitor', visitorId, req));
  }

  // Analysis bucket — only meaningful for assigned requests.
  let analysisBucket = null;
  if (assigned) {
    const bucketCookieName = buckets.map((b) => b.cookie).find((name) => cookies[name] !== undefined);
    if (bucketCookieName) {
      analysisBucket = parseInt(cookies[bucketCookieName], 10) % 100;
    } else {
      analysisBucket = analysisBucketFromVisitor(visitorId);
    }
  }

  // First-touch participant count for this experiment.
  const seenCookieName = `mendel_seen_${MENDEL_EXPERIMENT_ID}`;
  if (assigned && cookies[seenCookieName] === undefined) {
    counters.mendel_participants.add(1, attrsFor(analysisBucket));
    setCookies.push(buildSetCookie(seenCookieName, '1', req));
  }

  if (setCookies.length > 0) {
    res.append('Set-Cookie', setCookies);
  }

  req.mendelAssigned      = assigned;
  req.mendelAnalysisBucket = analysisBucket;

  res.on('finish', () => {
    const attrs = attrsFor(analysisBucket);
    counters.mendel_requests.add(1, attrs);
    requestDurationHistogram.record(Date.now() - startedAt, attrs);
    if (res.statusCode >= 500) {
      counters.mendel_server_errors.add(1, attrs);
    }
  });

  next();
}

function attrsFor(analysisBucket) {
  return analysisBucket === null || analysisBucket === undefined
    ? {}
    : { mendel_analysis_bucket: analysisBucket };
}

/**
 * Increment a declared experiment counter (page_view / settings_changed /
 * game_completed) for the given request, carrying its analysis-bucket
 * attribute when assigned. A no-op when instrumentation is disabled or the
 * counter name isn't one of the declared metrics.
 */
function recordDeclaredMetric(name, req) {
  if (!ENABLED) return;
  const counter = counters[name];
  if (!counter) return;
  const analysisBucket = req && req.mendelAnalysisBucket !== undefined ? req.mendelAnalysisBucket : null;
  counter.add(1, attrsFor(analysisBucket));
}

module.exports = {
  ENABLED,
  mendelMetricsMiddleware,
  recordDeclaredMetric,
};
