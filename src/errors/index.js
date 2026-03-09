// src/errors/index.js

// ─── Custom Error Classes ───────────────────────────────────────────────────

class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 422;
    this.category = 'VALIDATION_ERROR';
    this.details = details;
  }
}

class DatabaseError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'DatabaseError';
    this.statusCode = 503;
    this.category = 'DATABASE_ERROR';
    this.originalError = originalError;
  }
}

class SystemError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'SystemError';
    this.statusCode = 500;
    this.category = 'SYSTEM_ERROR';
    this.originalError = originalError;
  }
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.statusCode = 504;
    this.category = 'TIMEOUT_ERROR';
  }
}

// ─── Category Mapper ────────────────────────────────────────────────────────

/**
 * Maps any error (or latency context) to a stable error category string.
 * This is the central categorization logic — equivalent to Handler.php.
 *
 * @param {Error} err
 * @param {number} latencyMs  - used to detect timeout even on 200 responses
 * @returns {string} category
 */
function categorizeError(err, latencyMs = 0) {
  const TIMEOUT_THRESHOLD = parseInt(process.env.TIMEOUT_THRESHOLD_MS || '4000', 10);

  if (!err) {
    // Tricky case: 200 response but suspiciously slow → TIMEOUT_ERROR
    if (latencyMs > TIMEOUT_THRESHOLD) return 'TIMEOUT_ERROR';
    return null; // no error
  }

  if (err instanceof ValidationError) return 'VALIDATION_ERROR';
  if (err instanceof DatabaseError)   return 'DATABASE_ERROR';
  if (err instanceof TimeoutError)    return 'TIMEOUT_ERROR';
  if (err instanceof SystemError)     return 'SYSTEM_ERROR';

  // Fallback heuristics for untyped errors
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('sqlite') || msg.includes('database') || msg.includes('query')) {
    return 'DATABASE_ERROR';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'TIMEOUT_ERROR';
  }
  if (latencyMs > TIMEOUT_THRESHOLD) {
    return 'TIMEOUT_ERROR';
  }

  return 'UNKNOWN';
}

// ─── Central Express Error Handler ──────────────────────────────────────────

/**
 * Must be registered LAST in Express: app.use(centralErrorHandler)
 * Signature must have 4 args for Express to treat it as error middleware.
 */
function centralErrorHandler(err, req, res, next) {
  const logger  = require('../logger');
  const metrics = require('../metrics');

  const latencyMs = req._startTime ? Date.now() - req._startTime : 0;
  const category  = categorizeError(err, latencyMs);
  const status    = err.statusCode || 500;

  const logRecord = {
    // ── stable schema keys (always present) ──
    timestamp:             new Date().toISOString(),
    severity:              'error',
    correlation_id:        req.correlationId   || null,
    method:                req.method          || null,
    path:                  req.path            || null,
    route_name:            req.routeName       || 'unknown',
    status_code:           status,
    latency_ms:            latencyMs,
    error_category:        category,
    error_message:         err.message         || null,
    error_name:            err.name            || null,
    client_ip:             req.ip              || req.connection?.remoteAddress || null,
    user_agent:            req.get('user-agent')     || null,
    query:                 JSON.stringify(req.query) || null,
    payload_size_bytes:    parseInt(req.get('content-length') || '0', 10),
    response_size_bytes:   null, // not knowable post-error easily
    build_version:         process.env.BUILD_VERSION || 'unknown',
    host:                  require('os').hostname(),
    details:               err.details         || null,
  };

  logger.error('request_error', logRecord);

  // Update Prometheus error counter
  metrics.errorsTotal.inc({
    method:         req.method,
    path:           req.routeName || req.path,
    error_category: category,
  });

  res.status(status).json({
    error:    category,
    message:  err.message,
    details:  err.details || undefined,
  });
}

module.exports = {
  ValidationError,
  DatabaseError,
  SystemError,
  TimeoutError,
  categorizeError,
  centralErrorHandler,
};
