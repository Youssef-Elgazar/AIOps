// src/middleware/telemetry.js
const { v4: uuidv4 }    = require('uuid');
const os                = require('os');
const logger            = require('../logger');
const metrics           = require('../metrics');
const { categorizeError } = require('../errors');

/**
 * TelemetryMiddleware
 *
 * Responsibilities:
 *   1. Correlation ID propagation (read X-Request-Id or generate UUID)
 *   2. Precise latency measurement on every request (success + failure)
 *   3. Emit structured log record with stable schema on response finish
 *   4. Increment Prometheus RED counters + histogram
 *
 * Hard constraint: log schema must be STABLE — same keys always present,
 * null for missing values. Never drop a key.
 */
function telemetryMiddleware(req, res, next) {
  // ── 1. Correlation ID ────────────────────────────────────────────────────
  const correlationId = req.headers['x-request-id'] || uuidv4();
  req.correlationId   = correlationId;
  res.setHeader('X-Request-Id', correlationId);

  // ── 2. Start timer ───────────────────────────────────────────────────────
  req._startTime = Date.now();

  // ── 3. Capture request metadata ─────────────────────────────────────────
  const clientIp         = req.ip || req.connection?.remoteAddress || null;
  const userAgent        = req.get('user-agent') || null;
  const queryString      = JSON.stringify(req.query) || null;
  const payloadSizeBytes = parseInt(req.get('content-length') || '0', 10);

  // ── 4. Hook into response finish ─────────────────────────────────────────
  res.on('finish', () => {
    // Skip /metrics endpoint — we must not log it
    if (req.path === '/metrics') return;

    const latencyMs    = Date.now() - req._startTime;
    const latencySec   = latencyMs / 1000;
    const statusCode   = res.statusCode;
    const routeName    = req.routeName || deriveRouteName(req.path);
    const responseSizeBytes = parseInt(res.getHeader('content-length') || '0', 10);

    // Central categorization:
    // Even on 200, if latency > threshold → TIMEOUT_ERROR (intentional requirement)
    const errorCategory = categorizeError(req._error || null, latencyMs);
    const isError       = statusCode >= 400 || errorCategory !== null;
    const severity      = isError ? 'error' : 'info';

    // ── Stable log schema (every key always present) ─────────────────────
    const logRecord = {
      timestamp:            new Date().toISOString(),
      severity,
      correlation_id:       correlationId,
      method:               req.method,
      path:                 req.path,
      route_name:           routeName,
      status_code:          statusCode,
      latency_ms:           latencyMs,
      error_category:       errorCategory,
      error_message:        req._error?.message || null,
      client_ip:            clientIp,
      user_agent:           userAgent,
      query:                queryString,
      payload_size_bytes:   payloadSizeBytes,
      response_size_bytes:  responseSizeBytes || null,
      build_version:        process.env.BUILD_VERSION || 'unknown',
      host:                 os.hostname(),
    };

    if (severity === 'error') {
      logger.error('request_completed', logRecord);
    } else {
      logger.info('request_completed', logRecord);
    }

    // ── Prometheus metrics ───────────────────────────────────────────────
    const labelPath = routeName; // stable, no raw query strings

    metrics.requestsTotal.inc({
      method: req.method,
      path:   labelPath,
      status: String(statusCode),
    });

    metrics.requestDurationSeconds.observe(
      { method: req.method, path: labelPath },
      latencySec
    );

    // Error counter — only if there's a real error category
    if (errorCategory) {
      metrics.errorsTotal.inc({
        method:         req.method,
        path:           labelPath,
        error_category: errorCategory,
      });
    }
  });

  next();
}

/**
 * Derive a clean route name from the raw path.
 * Strips query strings and normalises to known route labels.
 * Prevents label explosion in Prometheus.
 */
function deriveRouteName(rawPath) {
  const clean = rawPath.split('?')[0].replace(/\/+$/, '') || '/';
  const known = [
    '/api/normal',
    '/api/slow',
    '/api/error',
    '/api/random',
    '/api/db',
    '/api/validate',
    '/api/anomaly',
    '/metrics',
    '/health',
  ];
  return known.includes(clean) ? clean : 'unknown';
}

module.exports = telemetryMiddleware;
