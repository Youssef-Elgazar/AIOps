// src/app.js
require('dotenv').config();

const express          = require('express');
const os               = require('os');
const telemetry        = require('./middleware/telemetry');
const apiRouter        = require('./routes/api');
const metrics          = require('./metrics');
const { centralErrorHandler } = require('./errors');

const app = express();

// ── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Trust proxy (for accurate client_ip behind Docker/nginx) ─────────────────
app.set('trust proxy', true);

// ── Telemetry middleware (must be before routes) ─────────────────────────────
app.use(telemetry);

// ── Health check (not logged, not metered) ───────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', host: os.hostname(), ts: new Date().toISOString() });
});

// ── Prometheus metrics endpoint ───────────────────────────────────────────────
// Must NOT be logged by telemetry (handled inside telemetry middleware via path check)
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `Route ${req.path} not found` });
});

// ── Central error handler (MUST be last) ─────────────────────────────────────
app.use(centralErrorHandler);

module.exports = app;
