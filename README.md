# AIOps Observability + Detection Project

Express.js + Prometheus + Grafana observability stack with a standalone Node.js detection engine.
By: Youssef Ali Elsayed Ahmed. ID: 20100251.

## Project Brief

This project demonstrates an end-to-end AIOps workflow in three phases. Phase 1 builds observability for an Express API using structured logs, Prometheus metrics, and Grafana dashboards. Phase 2 adds a standalone rule-based detection engine that continuously queries Prometheus, learns dynamic baselines, detects multi-signal anomalies, correlates signals into incidents, and emits alerts. Phase 3 adds an offline ML anomaly detection pipeline built from exported logs and ground-truth anomaly windows. Together, the system shows how to move from raw telemetry to actionable incident intelligence in a realistic, testable setup.

## Stack

| Component        | Tech                           |
| ---------------- | ------------------------------ |
| API Server       | Node.js + Express              |
| Database         | SQLite (sql.js)                |
| Validation       | Joi                            |
| Logging          | Winston (structured JSON)      |
| Metrics          | prom-client (Prometheus)       |
| Visualization    | Grafana                        |
| Load Generation  | Python 3 (stdlib only)         |
| Detection Engine | Node.js (standalone loop)      |
| ML Pipeline      | Python (pandas + scikit-learn) |
| Containers       | Docker Compose                 |

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
|- ml/
|  |- build_dataset.py       # Builds 60s-window dataset from logs.json
|  |- train_model.py         # Feature engineering + model training
|  |- predict.py             # Isolation Forest inference + metrics
|  |- visualize.py           # Plot generation
|  |- requirements.txt       # ML dependencies
|  |- aiops_dataset.csv      # Generated dataset
|  |- anomaly_predictions.csv # Generated predictions
|  |- models/
|  |  |- isolation_forest.pkl
|  |  |- oneclass_svm.pkl
|  |  |- scaler.pkl
|  |  |- feature_columns.json
|  |- plots/
|     |- latency_timeline.png
|     |- error_rate_timeline.png
|     |- anomaly_detection.png
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

## Phase 3 ML Anomaly Detection (Offline from Logs)

Phase 3 is fully log-driven and does not query Prometheus.

### Inputs

- `logs.json` (exported request logs)
- `ground_truth.json` (anomaly window timestamps)

### Setup

```bash
python -m pip install -r ml/requirements.txt
```

### Run Order

```bash
python ml/build_dataset.py
python ml/train_model.py
python ml/predict.py
python ml/visualize.py
```

### Step 1 - Dataset Construction

Script: `ml/build_dataset.py`

- Filters to request-completed records (`message == "request_completed"` or records with `latency_ms`)
- Parses timestamps as UTC
- Builds 60-second windows per endpoint
- Computes:
  - `avg_latency`
  - `max_latency`
  - `latency_std`
  - `request_rate`
  - `error_rate`
  - `errors_per_window`
  - `endpoint_frequency`
  - `is_anomaly_window` (window overlap with ground truth)
- Writes: `ml/aiops_dataset.csv`

Error record logic:

- `severity == "error"`
- OR `status_code >= 400`
- OR `error_category != null`

### Step 2 - Feature Engineering + Training

Script: `ml/train_model.py`

- Features:
  - numeric: `avg_latency, max_latency, latency_std, request_rate, error_rate, errors_per_window, endpoint_frequency`
  - categorical: one-hot encoded `endpoint`
- Standardizes features with `StandardScaler`
- Hard train/test split rule:
  - train: rows where `is_anomaly_window == 0`
  - test: all rows

### Step 3 - Models Saved

- Isolation Forest:
  - `contamination=0.05`
  - `n_estimators=200`
  - `random_state=42`
  - `max_samples="auto"`
- One-Class SVM:
  - `kernel="rbf"`
  - `nu=0.05`

Artifacts written to `ml/models/`:

- `isolation_forest.pkl`
- `oneclass_svm.pkl`
- `scaler.pkl`
- `feature_columns.json`

### Step 4 - Prediction + Detection Report

Script: `ml/predict.py`

- Loads model/scaler/features from disk
- Applies identical preprocessing
- Uses Isolation Forest outputs:
  - `decision_function()` -> `anomaly_score`
  - `predict()` -> `is_anomaly` (`-1` mapped to `1`, else `0`)
- Writes: `ml/anomaly_predictions.csv`
- Prints:
  - total predicted anomalies
  - true positives
  - false positives
  - false negatives
  - precision, recall, F1

### Step 5 - Visualization

Script: `ml/visualize.py`

Generates PNG plots in `ml/plots/`:

- `latency_timeline.png` - average latency per endpoint over time
- `error_rate_timeline.png` - error rate per endpoint over time
- `anomaly_detection.png` - anomaly score scatter with threshold line

Plot conventions:

- `matplotlib`, `figsize=(14, 5)`
- anomaly window highlighted in red
- rotated x-axis labels
- legends positioned outside plot area

### ML Dependencies

Contained in `ml/requirements.txt`:

- `pandas`
- `scikit-learn`
- `matplotlib`
- `joblib`
- `numpy`

### Notes

- All scripts are independently runnable and resolve paths relative to project root.
- If `is_anomaly_window` rows are zero, check timestamp overlap between `logs.json` and `ground_truth.json`; metrics like precision/recall/F1 will not be meaningful without overlap.

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
