'use strict';

/**
 * mendel-metrics.js — live-traffic experiment instrumentation for the
 * 'play-again-button' hop, 'event-driven-restart' variation.
 *
 * Uses the application's own OpenTelemetry SDK, wired to a completely
 * separate MeterProvider/reader/exporter from anything the app already has
 * (there is none here) so it never touches OTEL_EXPORTER_OTLP_* env vars and
 * is never registered as the global provider.
 *
 * Configuration is read explicitly from the environment:
 * MENDEL_METRICS_ENDPOINT, MENDEL_METRICS_TOKEN, MENDEL_EXPERIMENT_ID, and
 * (optional) MENDEL_EXPERIMENT_BUCKETS. When any of the first three are
 * missing or unreadable, metrics reporting is silently disabled — no cookie
 * is set, nothing is exported, and no user-visible error is ever raised.
 *
 * Declared experiment metrics (same across every variation of this hop):
 *   play_again_click / game_over_shown  (primary,   higher is better)
 *   page_reload       / game_over_shown  (guardrail, lower is better)
 *
 * `game_over_shown` is the shared denominator ("per") of both metrics above.
 * It is registered and reported as its own counter too so the ratios can be
 * computed, even though it isn't itself declared with a role/better.
 */

const crypto = require('crypto');

const METRICS_ENDPOINT = process.env.MENDEL_METRICS_ENDPOINT;
const METRICS_TOKEN    = process.env.MENDEL_METRICS_TOKEN;
const EXPERIMENT_ID    = process.env.MENDEL_EXPERIMENT_ID;

let BUCKETS = [];
try {
  if (process.env.MENDEL_EXPERIMENT_BUCKETS) {
    const parsed = JSON.parse(process.env.MENDEL_EXPERIMENT_BUCKETS);
    if (Array.isArray(parsed)) BUCKETS = parsed;
  }
} catch (err) {
  BUCKETS = []; // unreadable bucket list → set no bucket cookie, but don't fail the request
}

const METRICS_ENABLED = Boolean(METRICS_ENDPOINT && METRICS_TOKEN && EXPERIMENT_ID);

const HISTOGRAM_BOUNDARIES = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

// Declared experiment metrics for this hop. Every variation of
// 'play-again-button' declares (and increments) these same counters.
const DECLARED_METRICS = [
  {
    name: 'play_again_click', per: 'game_over_shown', role: 'primary', better: 'higher',
    description: 'Counts how often players click the Play Again button (or press Space) after the game-over screen is shown, divided by how many times the game-over screen was shown.',
  },
  {
    name: 'page_reload', per: 'game_over_shown', role: 'guardrail', better: 'lower',
    description: 'Counts full browser page reloads that occur after a game-over screen is shown, which should stay near zero since restart should happen without reloading.',
  },
];

// Every event name this hop's client can report — the declared metric names
// plus their shared 'per' denominator ('game_over_shown').
const TRACKED_EVENT_NAMES = Array.from(new Set(
  DECLARED_METRICS.flatMap((m) => [m.name, m.per]),
));

let counters = null;
let durationHistogram = null;

/**
 * Lazily create an isolated MeterProvider + PeriodicExportingMetricReader +
 * OTLP/HTTP protobuf exporter, entirely separate from any global OTel setup.
 * No-ops (leaves counters/durationHistogram null) when metrics are disabled.
 */
function setupMetrics() {
  if (!METRICS_ENABLED) return;

  let sdkMetrics, exporterMod, resourcesMod, semconv;
  try {
    sdkMetrics   = require('@opentelemetry/sdk-metrics');
    exporterMod  = require('@opentelemetry/exporter-metrics-otlp-proto');
    resourcesMod = require('@opentelemetry/resources');
    semconv      = require('@opentelemetry/semantic-conventions');
  } catch (err) {
    // OTel packages not installed / not resolvable — never fail the app because of this.
    return;
  }

  try {
    const { MeterProvider, PeriodicExportingMetricReader, View, ExplicitBucketHistogramAggregation } = sdkMetrics;
    const { OTLPMetricExporter } = exporterMod;
    const { Resource } = resourcesMod;
    const { SemanticResourceAttributes } = semconv;

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: crypto.randomUUID(),
    });

    const exporter = new OTLPMetricExporter({
      url: METRICS_ENDPOINT,
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    });

    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60000,
    });

    const provider = new MeterProvider({
      resource,
      readers: [reader],
      views: [
        new View({
          instrumentName: 'mendel_request_duration',
          aggregation: new ExplicitBucketHistogramAggregation(HISTOGRAM_BOUNDARIES),
        }),
      ],
    });

    const meter = provider.getMeter('play-again-button');

    counters = {
      mendel_participants:  meter.createCounter('mendel_participants'),
      mendel_requests:      meter.createCounter('mendel_requests'),
      mendel_server_errors: meter.createCounter('mendel_server_errors'),
    };

    TRACKED_EVENT_NAMES.forEach((name) => {
      if (!counters[name]) counters[name] = meter.createCounter(name);
    });

    durationHistogram = meter.createHistogram('mendel_request_duration');

    // Report every counter once at process start, with no attributes, so the
    // deployment shows each one even where its event can't happen yet.
    Object.values(counters).forEach((c) => c.add(0));
  } catch (err) {
    // Never let telemetry setup break the app.
    counters = null;
    durationHistogram = null;
  }
}

setupMetrics();

function incr(name, attributes) {
  if (!METRICS_ENABLED || !counters || !counters[name]) return;
  try {
    counters[name].add(1, attributes || {});
  } catch (err) {
    // swallow — telemetry must never surface as a user-visible failure
  }
}

function recordDuration(ms, attributes) {
  if (!METRICS_ENABLED || !durationHistogram) return;
  try {
    durationHistogram.record(ms, attributes || {});
  } catch (err) {
    // swallow
  }
}

// ── Cookie helpers (no cookie-parser dependency) ────────────────────────────

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch (err) {
        out[k] = v;
      }
    }
  });
  return out;
}

function serializeCookie(name, value, opts) {
  const options = opts || {};
  let str = `${name}=${encodeURIComponent(value)}; Path=/`;
  if (options.maxAgeSeconds) str += `; Max-Age=${options.maxAgeSeconds}`;
  if (options.httpOnly) str += '; HttpOnly';
  str += `; SameSite=${options.sameSite || 'Lax'}`;
  if (options.secure) str += '; Secure';
  return str;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * HMAC-SHA256(salt, participantKey) → first 8 bytes as big-endian uint64 %
 * 1,000,000, zero-padded to 6 digits.
 */
function computeBucket(salt, participantKey) {
  const digest = crypto.createHmac('sha256', salt).update(String(participantKey)).digest();
  const n = digest.readBigUInt64BE(0) % 1000000n;
  return String(n).padStart(6, '0');
}

/**
 * SHA-256(visitorId) → first 8 bytes as big-endian uint64 % 100.
 */
function analysisBucketFromVisitor(visitorId) {
  const digest = crypto.createHash('sha256').update(String(visitorId)).digest();
  return Number(digest.readBigUInt64BE(0) % 100n);
}

/**
 * Express middleware: assigns/refreshes the mendel_visitor cookie, derives
 * the Analysis Bucket, counts mendel_requests/mendel_request_duration/
 * mendel_server_errors/mendel_participants. Stashes the attribute set used
 * for this request on res.locals.mendelAttrs so route handlers can report a
 * declared event (e.g. play_again_click) with the same attribution.
 *
 * Never throws, never sets a cookie or reports anything when metrics
 * reporting is disabled (missing endpoint/token/experiment id).
 */
function mendelMiddleware(req, res, next) {
  const startNs = process.hrtime.bigint();

  let cookies = {};
  try {
    cookies = parseCookies(req.headers && req.headers.cookie);
  } catch (err) {
    cookies = {};
  }

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookiesToSet = [];

  // This experiment's assignment_unit is 'device' — the arm/bucket is
  // decided (and any bucket cookie set) upstream of this code, at the edge.
  // Here we only read what's already present to compute the Analysis Bucket.

  // mendel_visitor: a stable per-browser id, set once, used for the
  // Analysis Bucket when no explicit bucket cookie is present.
  let visitorId = cookies.mendel_visitor;
  if (!visitorId) {
    visitorId = crypto.randomBytes(16).toString('hex');
    cookiesToSet.push(serializeCookie('mendel_visitor', visitorId, {
      maxAgeSeconds: ONE_YEAR_SECONDS, httpOnly: true, sameSite: 'Lax', secure: isHttps,
    }));
  }

  // A request is "assigned" if it carries mendel_arm, or any bucket cookie
  // named in MENDEL_EXPERIMENT_BUCKETS.
  const bucketCookieName = BUCKETS.map((b) => b.cookie).find((name) => cookies[name] !== undefined);
  const isAssigned = Boolean(cookies.mendel_arm || bucketCookieName);

  let analysisBucket = null;
  if (isAssigned) {
    if (bucketCookieName) {
      const n = parseInt(cookies[bucketCookieName], 10);
      analysisBucket = Number.isFinite(n) ? n % 100 : null;
    } else {
      analysisBucket = analysisBucketFromVisitor(visitorId);
    }
  }

  const attrs = (isAssigned && analysisBucket !== null) ? { mendel_analysis_bucket: analysisBucket } : {};

  // First-seen participant for this experiment.
  const seenCookieName = EXPERIMENT_ID ? `mendel_seen_${EXPERIMENT_ID}` : null;
  if (isAssigned && seenCookieName && !cookies[seenCookieName]) {
    incr('mendel_participants', attrs);
    cookiesToSet.push(serializeCookie(seenCookieName, '1', {
      maxAgeSeconds: ONE_YEAR_SECONDS, httpOnly: true, sameSite: 'Lax', secure: isHttps,
    }));
  }

  if (METRICS_ENABLED && cookiesToSet.length) {
    res.setHeader('Set-Cookie', cookiesToSet);
  }

  // Exposed so route handlers (e.g. POST /api/events) can report a declared
  // event with the exact same attribution computed for this request.
  res.locals = res.locals || {};
  res.locals.mendelAttrs = attrs;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    incr('mendel_requests', attrs);
    recordDuration(durationMs, attrs);
    if (res.statusCode >= 500) {
      incr('mendel_server_errors', attrs);
    }
  });

  next();
}

module.exports = {
  METRICS_ENABLED,
  DECLARED_METRICS,
  TRACKED_EVENT_NAMES,
  mendelMiddleware,
  incr,
  recordDuration,
  // exported for unit testing
  parseCookies,
  serializeCookie,
  computeBucket,
  analysisBucketFromVisitor,
};
