# AIOps Observability + Detection Project

Express.js + Prometheus + Grafana observability stack with a standalone Node.js detection engine.
By: Youssef Ali Elsayed Ahmed. ID: 20100251.

## Project Brief

This project demonstrates an end-to-end AIOps workflow in two phases. Phase 1 builds observability for an Express API using structured logs, Prometheus metrics, and Grafana dashboards. Phase 2 adds a standalone detection engine that continuously queries Prometheus, learns dynamic baselines, detects multi-signal anomalies, correlates signals into incidents, and emits alerts. Together, the system shows how to move from raw telemetry to actionable incident intelligence in a realistic, testable setup.

## Stack

| Component        | Tech                      |
| ---------------- | ------------------------- |
| API Server       | Node.js + Express         |
| Database         | SQLite (sql.js)           |
| Validation       | Joi                       |
| Logging          | Winston (structured JSON) |
| Metrics          | prom-client (Prometheus)  |
| Visualization    | Grafana                   |
| Load Generation  | Python 3 (stdlib only)    |
| Detection Engine | Node.js (standalone loop) |
| Containers       | Docker Compose            |

---

## Project Structure

```text
aiops-project/
|- detector/
|  |- detect.js              # Detection engine entry point (continuous loop)
|  |- prometheusClient.js    # Prometheus HTTP API query wrapper
|  |- baseline.js            # Baseline model + EMA + persistence
|  |- anomalyDetector.js     # Multi-signal anomaly rules
|  |- correlator.js          # Signal correlation -> single incident
|  |- incidentStore.js       # Incident generation + persistence
|  |- alerter.js             # Console + JSON alerts with dedup
|  |- baselines.json         # Created/updated by detector
|- src/
|  |- app.js
|  |- server.js
|  |- routes/api.js
|  |- middleware/telemetry.js
|  |- errors/index.js
|  |- metrics/index.js
|  |- db/index.js
|  |- logger/index.js
|- scripts/
|  |- export_logs.js
|  |- traffic_generator.py
|- storage/
|  |- logs/
|  |- aiops/
|     |- incidents.json      # Created/updated by detector
|     |- alerts.json         # Created/updated by detector
|- Reports/
|  |- Report_1.pdf         # Report for Lab Work 1.
|  |- Report_2.pdf         # Report for Lab Work 2.
|- grafana/
|- docker-compose.yml
|- prometheus.yml
|- Dockerfile
|- ground_truth.json
|- logs.json
|- package.json
```

---

## Quick Start

### Option A - Docker (recommended)

```bash
docker compose up --build
```

- API: http://localhost:3000
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin / admin)

### Option B - Local dev

```bash
npm install
npm run dev
```

Run detector in a second terminal:

```bash
node detector/detect.js
```

---

## API Endpoints

| Method | Path               | Description                                                   |
| ------ | ------------------ | ------------------------------------------------------------- |
| GET    | `/api/normal`      | Fast success (5-20ms)                                         |
| GET    | `/api/slow`        | Slow success (1-3s)                                           |
| GET    | `/api/slow?hard=1` | Very slow (5-7s), logs as TIMEOUT_ERROR even on 200           |
| GET    | `/api/error`       | Always throws SystemError (500)                               |
| GET    | `/api/random`      | Approx. 75% success, 25% random errors                        |
| GET    | `/api/db`          | Real SQLite query                                             |
| GET    | `/api/db?fail=1`   | Forced DatabaseError (bad table)                              |
| POST   | `/api/validate`    | Validates `{ email, age }`, throws ValidationError if invalid |
| POST   | `/api/anomaly`     | Body `{ active: true/false }`, sets anomaly_window_active     |
| GET    | `/metrics`         | Prometheus scrape endpoint                                    |
| GET    | `/health`          | Health check                                                  |

---

## Error Categories

- `VALIDATION_ERROR`
- `DATABASE_ERROR`
- `SYSTEM_ERROR`
- `TIMEOUT_ERROR`
- `UNKNOWN`

Key behavior: `/api/slow?hard=1` can return HTTP 200 and still be classified as `TIMEOUT_ERROR` based on latency threshold.

---

## Prometheus Metrics

| Metric                          | Type      | Labels                       |
| ------------------------------- | --------- | ---------------------------- |
| `http_requests_total`           | Counter   | method, path, status         |
| `http_errors_total`             | Counter   | method, path, error_category |
| `http_request_duration_seconds` | Histogram | method, path                 |
| `anomaly_window_active`         | Gauge     | -                            |

Histogram buckets:

`0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, +Inf`

---

## Phase 2 Detection Engine

The detector runs independently from Express and continuously queries Prometheus.

Run command:

```bash
node detector/detect.js
```

Detection flow:

1. Warm baselines with 3 samples, 20 seconds apart
2. Loop forever every 20 seconds
3. Query current metrics from Prometheus
4. Compare current values against baseline
5. Generate active signals
6. Correlate signals into one incident type
7. Store incident in `storage/aiops/incidents.json`
8. Emit alert to console and `storage/aiops/alerts.json`
9. Update baseline via EMA and persist to `detector/baselines.json`

### Baseline Model

Per endpoint tracked baseline values:

- `avgLatency`
- `requestRate`
- `errorRate`

EMA update:

$$
new\_baseline = alpha * current\_value + (1 - alpha) * old\_baseline
$$

- `alpha = 0.1`
- Baselines are computed from real Prometheus data (not hardcoded)

Baselined endpoints:

- `/api/normal`
- `/api/slow`
- `/api/db`
- `/api/error`
- `/api/validate`

### Signal Rules

- `LATENCY_ANOMALY`: current P95 latency > 3 x baseline avg latency
- `ERROR_RATE_ANOMALY`: current error rate > 10% and > 2 x baseline error rate
- `TRAFFIC_ANOMALY`: current request rate > 2 x baseline request rate
- `ENDPOINT_FAILURE`: endpoint error rate > 80%

Signal object:

```json
{
  "signal_type": "ERROR_RATE_ANOMALY",
  "endpoint": "/api/error",
  "current_value": 1,
  "baseline_value": 0.2,
  "ratio": 5
}
```

### Correlated Incident Types

- `SERVICE_DEGRADATION`
- `ERROR_STORM`
- `LATENCY_SPIKE`
- `TRAFFIC_SURGE`
- `LOCALIZED_ENDPOINT_FAILURE`

### Incident Schema

Each incident includes:

- `incident_id` (UUID v4)
- `incident_type`
- `severity` (`low | medium | high | critical`)
- `status` (`open | resolved`)
- `detected_at` (ISO 8601)
- `affected_service` (`aiops-api`)
- `affected_endpoints`
- `triggering_signals`
- `baseline_values`
- `observed_values`
- `summary`

Severity mapping by number of active signals:

- 1 -> `low`
- 2 -> `medium`
- 3 -> `high`
- 4+ -> `critical`

### Alerting

On each new incident:

1. Emit formatted console alert
2. Append alert object to `storage/aiops/alerts.json`

Alert schema:

```json
{
  "incident_id": "...",
  "incident_type": "...",
  "severity": "...",
  "timestamp": "...",
  "summary": "..."
}
```

Dedup behavior: an `incident_id` is alerted only once.

---

## Running the Traffic Generator

Requires Python 3.6+ (no external packages).

```bash
# Error spike anomaly (default)
python scripts/traffic_generator.py --anomaly error_spike

# Latency spike anomaly
python scripts/traffic_generator.py --anomaly latency_spike
```

Traffic phases:

1. Base load (10 min)
2. Anomaly window (2 min)
3. Recovery (2 min)

Output file:

- `ground_truth.json`

---

## Export Logs

```bash
node scripts/export_logs.js
```

Output file:

- `logs.json`

---

## Prometheus Queries Used by Detector

- Request rate:
  - `sum(rate(http_requests_total{path="..."}[2m]))`
- Error rate:
  - `sum(rate(http_errors_total{path="..."}[2m])) / clamp_min(sum(rate(http_requests_total{path="..."}[2m])), 0.000001)`
- P95 latency:
  - `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{path="..."}[2m])))`
- Error category rate:
  - `sum(rate(http_errors_total{error_category="..."}[2m]))`

---

## Latest End-to-End Validation

With detector running and `python scripts/traffic_generator.py --anomaly error_spike`:

- Base error rate: `5.89%`
- Anomaly error rate: `42.89%`
- Recovery error rate: approx. `6%`
- Incidents and alerts were generated and persisted in `storage/aiops/`

This confirms observability (Phase 1) and anomaly detection/correlation (Phase 2) are integrated and functioning end-to-end.

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
