# AIOps Observability Project

Express.js + Prometheus + Grafana observability stack with controlled anomaly injection.
By: Youssef Ali Elsayed Ahmed. ID: 20100251.

## Stack

| Component     | Tech                      |
| ------------- | ------------------------- |
| API Server    | Node.js + Express         |
| Database      | SQLite (better-sqlite3)   |
| Validation    | Joi                       |
| Logging       | Winston (structured JSON) |
| Metrics       | prom-client (Prometheus)  |
| Visualization | Grafana                   |
| Load Gen      | Python 3 (stdlib only)    |
| Containers    | Docker Compose            |

---

## Project Structure

```
aiops-project/
├── src/
│   ├── app.js                  # Express app + middleware registration
│   ├── server.js               # Entry point
│   ├── routes/api.js           # All /api/* endpoints
│   ├── middleware/telemetry.js # Correlation ID, latency, structured logs
│   ├── errors/index.js         # Custom error classes + central handler
│   ├── metrics/index.js        # prom-client RED metrics
│   ├── db/index.js             # SQLite setup + seeding
│   └── logger/index.js         # Winston JSON logger
├── scripts/
│   └── export_logs.js          # Export aiops.log → logs.json
├── storage/logs/               # aiops.log lives here (auto-created)
├── grafana/provisioning/       # Auto-provisioned datasource + dashboard
├── traffic_generator.py        # Python load generator
├── ground_truth.json           # Written by traffic generator
├── logs.json                   # Written by export_logs.js
├── .env                        # Config (PORT, BUILD_VERSION, etc.)
├── docker-compose.yml
├── prometheus.yml
└── Dockerfile
```

---

## Quick Start

### Option A — Docker (recommended)

```bash
docker compose up --build
```

- API: http://localhost:3000
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin / admin)

### Option B — Local dev

```bash
npm install
npm run dev   # uses nodemon
```

---

## API Endpoints

| Method | Path               | Description                                                    |
| ------ | ------------------ | -------------------------------------------------------------- |
| GET    | `/api/normal`      | Fast success (5–20ms)                                          |
| GET    | `/api/slow`        | Slow success (1–3s)                                            |
| GET    | `/api/slow?hard=1` | Very slow — triggers TIMEOUT_ERROR in logs even on 200         |
| GET    | `/api/error`       | Always throws SystemError                                      |
| GET    | `/api/random`      | ~75% success, ~25% random errors                               |
| GET    | `/api/db`          | Real SQLite query                                              |
| GET    | `/api/db?fail=1`   | Forced DatabaseError (bad table)                               |
| POST   | `/api/validate`    | Validates `{ email, age }` — throws ValidationError if invalid |
| POST   | `/api/anomaly`     | `{ active: true/false }` — sets Prometheus anomaly gauge       |
| GET    | `/metrics`         | Prometheus scrape endpoint (not logged)                        |
| GET    | `/health`          | Health check                                                   |

---

## Error Categories

Central categorization in `src/errors/index.js`:

| Category           | Trigger                                      |
| ------------------ | -------------------------------------------- |
| `VALIDATION_ERROR` | Joi validation failure on POST /api/validate |
| `DATABASE_ERROR`   | SQLite error on /api/db?fail=1               |
| `SYSTEM_ERROR`     | /api/error, unhandled exceptions             |
| `TIMEOUT_ERROR`    | latency > 4000ms (even on 200 responses!)    |
| `UNKNOWN`          | Unclassified errors                          |

> **Key design**: `/api/slow?hard=1` returns HTTP 200 but logs `error_category: TIMEOUT_ERROR`
> because latency exceeds the 4000ms threshold. This is visible in both logs and Prometheus.

---

## Log Schema

Every log record has these keys (nulls when not applicable):

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "severity": "info | error",
  "correlation_id": "uuid-v4",
  "method": "GET",
  "path": "/api/normal",
  "route_name": "/api/normal",
  "status_code": 200,
  "latency_ms": 12,
  "error_category": null,
  "error_message": null,
  "client_ip": "127.0.0.1",
  "user_agent": "python-urllib/3.11",
  "query": "{}",
  "payload_size_bytes": 0,
  "response_size_bytes": null,
  "build_version": "1.0.0",
  "host": "hostname"
}
```

---

## Running the Traffic Generator

Requires Python 3.6+ (no external packages needed).

```bash
# Error spike anomaly (default)
python3 traffic_generator.py --anomaly error_spike

# Latency spike anomaly
python3 traffic_generator.py --anomaly latency_spike
```

This runs:

1. **Base load** (10 min) — 3000+ requests, realistic distribution
2. **Anomaly** (2 min) — spike in errors or latency
3. **Recovery** (2 min) — return to normal

Outputs `ground_truth.json` with anomaly timestamps.

---

## Export Logs

After running the traffic generator:

```bash
node scripts/export_logs.js
```

Outputs `logs.json` with ≥1500 entries, ≥100 error records, stable schema.

---

## Prometheus Metrics

| Metric                          | Type      | Labels                       |
| ------------------------------- | --------- | ---------------------------- |
| `http_requests_total`           | Counter   | method, path, status         |
| `http_errors_total`             | Counter   | method, path, error_category |
| `http_request_duration_seconds` | Histogram | method, path                 |
| `anomaly_window_active`         | Gauge     | —                            |

Histogram buckets: `0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, +Inf`

---

## Grafana Dashboard

Auto-provisioned at startup. Panels:

1. **Request rate per endpoint** (RPS)
2. **Error rate % per endpoint**
3. **P50 / P95 / P99 latency per endpoint**
4. **Error category breakdown** (stacked: VALIDATION / DB / SYSTEM / TIMEOUT)
5. **Anomaly window marker** (red band during injection)

Anomaly windows are also shown as Grafana annotations (red vertical markers).

---

## Environment Variables

```env
PORT=3000
BUILD_VERSION=1.0.0
NODE_ENV=development
DB_PATH=./storage/aiops.db
LOG_PATH=./storage/logs/aiops.log
TIMEOUT_THRESHOLD_MS=4000
```
