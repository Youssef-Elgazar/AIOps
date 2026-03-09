// src/metrics/index.js
const client = require('prom-client');

// Use a custom registry to avoid conflicts
const register = new client.Registry();

// Collect default Node.js metrics (memory, CPU, etc.)
client.collectDefaultMetrics({ register });

// ─── RED Counters ────────────────────────────────────────────────────────────

/**
 * R - Rate: total requests per endpoint
 */
const requestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

/**
 * E - Errors: error count broken down by category
 */
const errorsTotal = new client.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP errors by category',
  labelNames: ['method', 'path', 'error_category'],
  registers: [register],
});

// ─── Duration Histogram ──────────────────────────────────────────────────────

/**
 * D - Duration: request latency histogram.
 * Buckets chosen to cover the full range of our endpoints:
 *   - /api/normal  → ~5-20ms
 *   - /api/slow    → ~1-3s
 *   - /api/slow?hard=1 → ~5-7s
 *   - /api/db      → ~10-50ms
 */
const requestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, Infinity],
  registers: [register],
});

// ─── Anomaly Gauge ───────────────────────────────────────────────────────────
// A gauge that is set to 1 during the anomaly window by the traffic generator
// via a dedicated endpoint. Used for Grafana annotations.
const anomalyActive = new client.Gauge({
  name: 'anomaly_window_active',
  help: '1 if anomaly injection is currently active, 0 otherwise',
  registers: [register],
});

module.exports = {
  register,
  requestsTotal,
  errorsTotal,
  requestDurationSeconds,
  anomalyActive,
};
