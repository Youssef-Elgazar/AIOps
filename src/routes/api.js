// src/routes/api.js
const express = require("express");
const Joi = require("joi");
const router = express.Router();

const dbModule = require("../db");
const metrics = require("../metrics");
const { ValidationError, DatabaseError, SystemError } = require("../errors");

// Resolve db once at startup (server.js already awaited ready, so this is instant)
let db;
dbModule.ready.then((instance) => {
  db = instance;
});

// ── Helper: async wrapper so thrown errors reach centralErrorHandler ─────────
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ── Attach route name for telemetry ─────────────────────────────────────────
router.use((req, res, next) => {
  req.routeName = `/api${req.path}`.replace(/\/+$/, "");
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/normal
// Fast, always-succeeds endpoint
// ─────────────────────────────────────────────────────────────────────────────
router.get("/normal", (req, res) => {
  res.json({
    status: "ok",
    message: "Normal response",
    ts: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/slow
// Simulates slow response.
//   ?hard=1  → sleeps 5–7 seconds (classified as TIMEOUT_ERROR even on 200)
//   default  → sleeps 1–3 seconds
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/slow",
  asyncHandler(async (req, res) => {
    const hard = req.query.hard === "1";
    const delay = hard
      ? randomBetween(5000, 7000) // hard timeout simulation
      : randomBetween(1000, 3000); // normal slow

    await sleep(delay);

    res.json({
      status: "ok",
      message: hard
        ? "Hard slow response (timeout simulation)"
        : "Slow response",
      delay_ms: delay,
      ts: new Date().toISOString(),
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/error
// Always throws a SystemError
// ─────────────────────────────────────────────────────────────────────────────
router.get("/error", (req, res, next) => {
  next(
    new SystemError("Simulated system failure — something went wrong upstream"),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/random
// Randomly succeeds or fails
// ─────────────────────────────────────────────────────────────────────────────
router.get("/random", (req, res, next) => {
  const roll = Math.random();

  if (roll < 0.15) {
    return next(new SystemError("Random system error"));
  }
  if (roll < 0.25) {
    return next(new DatabaseError("Random DB error"));
  }

  res.json({
    status: "ok",
    message: "Random success",
    roll: roll.toFixed(4),
    ts: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/db
// Real SQLite query.
//   ?fail=1  → queries a nonexistent table → throws DatabaseError
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/db",
  asyncHandler(async (req, res, next) => {
    const fail = req.query.fail === "1";

    try {
      if (fail) {
        // Intentionally bad query to simulate QueryException
        db.prepare("SELECT * FROM nonexistent_table_xyz WHERE id = 1").get();
      }

      const users = db
        .prepare("SELECT id, name, email, created_at FROM users LIMIT 10")
        .all();
      res.json({
        status: "ok",
        count: users.length,
        data: users,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      // Map SQLite errors → DatabaseError so central handler can categorize
      if (fail || err.message?.toLowerCase().includes("sqlite")) {
        return next(new DatabaseError(`DB query failed: ${err.message}`, err));
      }
      return next(err);
    }
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/validate
// Accepts { email, age } — throws ValidationError if invalid
// ─────────────────────────────────────────────────────────────────────────────
const validateSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "email must be a valid email address",
    "any.required": "email is required",
  }),
  age: Joi.number().integer().min(18).max(60).required().messages({
    "number.base": "age must be a number",
    "number.integer": "age must be an integer",
    "number.min": "age must be at least 18",
    "number.max": "age must be at most 60",
    "any.required": "age is required",
  }),
});

router.post(
  "/validate",
  asyncHandler(async (req, res, next) => {
    const { error, value } = validateSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      }));
      return next(new ValidationError("Validation failed", details));
    }

    res.status(200).json({
      status: "ok",
      message: "Payload is valid",
      data: value,
      ts: new Date().toISOString(),
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/anomaly
// Called by traffic_generator.py to toggle the anomaly window gauge.
// Body: { active: true | false }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/anomaly", (req, res) => {
  const active = req.body?.active === true || req.body?.active === "true";
  metrics.anomalyActive.set(active ? 1 : 0);
  res.json({ status: "ok", anomaly_active: active });
});

// ─── Utility helpers ─────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = router;
