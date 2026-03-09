#!/usr/bin/env python3
"""
traffic_generator.py
Controlled load generator for the AIOps observability project.

Phases:
  1. Base load  (8–12 min) — realistic production-like distribution
  2. Anomaly    (2 min)    — injected spike (error OR latency)
  3. Recovery   (2 min)    — return to normal

Outputs: ground_truth.json
"""

import time
import random
import json
import argparse
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import urllib.request
import urllib.error
import urllib.parse

# ─── Config ──────────────────────────────────────────────────────────────────

BASE_URL        = "http://localhost:3000"
BASE_DURATION   = 10 * 60          # 10 minutes base load
ANOMALY_DURATION = 2 * 60          # 2 minutes anomaly
RECOVERY_DURATION = 2 * 60         # 2 minutes recovery
TARGET_REQUESTS = 3000             # minimum total requests
MAX_WORKERS     = 20               # concurrent threads

# ─── Base load distribution ───────────────────────────────────────────────────
BASE_DISTRIBUTION = [
    ("/api/normal",         0.70, "GET",  None),
    ("/api/slow",           0.15, "GET",  None),
    ("/api/slow?hard=1",    0.05, "GET",  None),
    ("/api/error",          0.05, "GET",  None),
    ("/api/db",             0.03, "GET",  None),
    ("/api/validate",       0.02, "POST", None),   # mixed valid/invalid
]

# ─── Anomaly distributions ────────────────────────────────────────────────────
ANOMALY_ERROR_SPIKE = [
    ("/api/normal",         0.40, "GET",  None),
    ("/api/slow",           0.05, "GET",  None),
    ("/api/slow?hard=1",    0.05, "GET",  None),
    ("/api/error",          0.40, "GET",  None),   # ← spike to 40%
    ("/api/db",             0.05, "GET",  None),
    ("/api/validate",       0.05, "POST", None),
]

ANOMALY_LATENCY_SPIKE = [
    ("/api/normal",         0.50, "GET",  None),
    ("/api/slow",           0.10, "GET",  None),
    ("/api/slow?hard=1",    0.30, "GET",  None),   # ← spike to 30%
    ("/api/error",          0.05, "GET",  None),
    ("/api/db",             0.03, "GET",  None),
    ("/api/validate",       0.02, "POST", None),
]

# ─── Sample payloads for /api/validate ───────────────────────────────────────
VALID_PAYLOADS = [
    {"email": "alice@example.com", "age": 25},
    {"email": "bob@test.org",      "age": 40},
    {"email": "charlie@corp.io",   "age": 33},
]
INVALID_PAYLOADS = [
    {"email": "not-an-email",      "age": 25},   # bad email
    {"email": "ok@test.com",       "age": 15},   # age too low
    {"email": "ok@test.com",       "age": 75},   # age too high
    {"email": "",                  "age": 30},   # missing email
    {"email": "ok@test.com"},                    # missing age
    {"email": "ok@test.com",       "age": "x"},  # non-integer
]


# ─── HTTP helper ─────────────────────────────────────────────────────────────

def make_request(path, method="GET", body=None):
    url = BASE_URL + path
    data = None
    headers = {"Content-Type": "application/json"}

    if body:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, True
    except urllib.error.HTTPError as e:
        return e.code, False
    except Exception:
        return 0, False


def pick_validate_payload():
    """50% valid, 50% invalid as required."""
    if random.random() < 0.5:
        return random.choice(VALID_PAYLOADS)
    return random.choice(INVALID_PAYLOADS)


def send_one(entry):
    path, _, method, _ = entry
    body = None
    if path == "/api/validate":
        body = pick_validate_payload()
    status, ok = make_request(path, method=method, body=body)
    return path, status, ok


def weighted_pick(distribution):
    r = random.random()
    cumulative = 0.0
    for entry in distribution:
        cumulative += entry[1]
        if r <= cumulative:
            return entry
    return distribution[-1]


def set_anomaly_flag(active: bool):
    make_request("/api/anomaly", method="POST", body={"active": active})


# ─── Stats tracker ────────────────────────────────────────────────────────────

class Stats:
    def __init__(self):
        self.lock   = threading.Lock()
        self.total  = 0
        self.errors = 0
        self.by_path = {}

    def record(self, path, status, ok):
        with self.lock:
            self.total += 1
            if not ok or status >= 400:
                self.errors += 1
            key = path.split("?")[0]
            if key not in self.by_path:
                self.by_path[key] = {"total": 0, "errors": 0}
            self.by_path[key]["total"] += 1
            if not ok or status >= 400:
                self.by_path[key]["errors"] += 1

    def print_summary(self, phase=""):
        print(f"\n{'─'*50}")
        print(f"  Phase: {phase}")
        print(f"  Total requests : {self.total}")
        print(f"  Total errors   : {self.errors}")
        print(f"  Error rate     : {self.errors/max(self.total,1)*100:.1f}%")
        for path, d in self.by_path.items():
            pct = d['errors'] / max(d['total'], 1) * 100
            print(f"    {path:<30} {d['total']:>5} req  {pct:>6.1f}% err")
        print(f"{'─'*50}\n")


# ─── Load runner ─────────────────────────────────────────────────────────────

def run_phase(distribution, duration_sec, stats, label):
    """Send requests at ~steady rate for `duration_sec` seconds."""
    end_time = time.time() + duration_sec
    count = 0

    # Calculate a rough sleep between requests to stay sane
    # We want roughly TARGET_REQUESTS / BASE_DURATION per second
    rps = TARGET_REQUESTS / (BASE_DURATION + ANOMALY_DURATION + RECOVERY_DURATION)
    sleep_between = max(0.01, (1.0 / rps) / MAX_WORKERS)

    print(f"\n[{datetime.now().isoformat()}] Starting phase: {label} ({duration_sec}s)")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = []
        while time.time() < end_time:
            entry = weighted_pick(distribution)
            future = pool.submit(send_one, entry)
            futures.append(future)
            count += 1
            time.sleep(sleep_between)

            # Drain completed futures periodically
            if len(futures) > MAX_WORKERS * 2:
                done = [f for f in futures if f.done()]
                for f in done:
                    path, status, ok = f.result()
                    stats.record(path, status, ok)
                futures = [f for f in futures if not f.done()]

        # Drain remaining
        for f in as_completed(futures):
            path, status, ok = f.result()
            stats.record(path, status, ok)

    print(f"[{datetime.now().isoformat()}] Phase complete: {label} — {count} requests dispatched")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AIOps traffic generator")
    parser.add_argument(
        "--anomaly",
        choices=["error_spike", "latency_spike"],
        default="error_spike",
        help="Anomaly type to inject (default: error_spike)",
    )
    args = parser.parse_args()

    anomaly_distribution = (
        ANOMALY_ERROR_SPIKE if args.anomaly == "error_spike"
        else ANOMALY_LATENCY_SPIKE
    )
    anomaly_type = args.anomaly

    stats_base     = Stats()
    stats_anomaly  = Stats()
    stats_recovery = Stats()

    # ── Phase 1: Base load ──────────────────────────────────────────────────
    run_phase(BASE_DISTRIBUTION, BASE_DURATION, stats_base, "BASE LOAD")
    stats_base.print_summary("BASE LOAD")

    # ── Phase 2: Anomaly window ─────────────────────────────────────────────
    anomaly_start = datetime.now(timezone.utc)
    set_anomaly_flag(True)
    print(f"\n{'='*50}")
    print(f"  ⚠️  ANOMALY START: {anomaly_start.isoformat()}")
    print(f"  Type: {anomaly_type}")
    print(f"{'='*50}")

    run_phase(anomaly_distribution, ANOMALY_DURATION, stats_anomaly, f"ANOMALY ({anomaly_type})")
    stats_anomaly.print_summary(f"ANOMALY ({anomaly_type})")

    anomaly_end = datetime.now(timezone.utc)
    set_anomaly_flag(False)
    print(f"\n{'='*50}")
    print(f"  ✅  ANOMALY END: {anomaly_end.isoformat()}")
    print(f"{'='*50}")

    # ── Phase 3: Recovery ────────────────────────────────────────────────────
    run_phase(BASE_DISTRIBUTION, RECOVERY_DURATION, stats_recovery, "RECOVERY")
    stats_recovery.print_summary("RECOVERY")

    # ── Ground truth export ──────────────────────────────────────────────────
    expected = {
        "error_spike":   "Error rate should spike from ~5% to ~40% on /api/error during anomaly window",
        "latency_spike": "P95/P99 latency should spike on /api/slow?hard=1 rising from ~5% to ~30% of traffic",
    }

    ground_truth = {
        "anomaly_start_iso":   anomaly_start.isoformat(),
        "anomaly_end_iso":     anomaly_end.isoformat(),
        "anomaly_type":        anomaly_type,
        "expected_behavior":   expected[anomaly_type],
        "base_total_requests": stats_base.total,
        "anomaly_total_requests": stats_anomaly.total,
        "base_error_rate_pct":    round(stats_base.errors / max(stats_base.total, 1) * 100, 2),
        "anomaly_error_rate_pct": round(stats_anomaly.errors / max(stats_anomaly.total, 1) * 100, 2),
    }

    with open("ground_truth.json", "w") as f:
        json.dump(ground_truth, f, indent=2)

    print(f"\n✅  ground_truth.json written")
    print(json.dumps(ground_truth, indent=2))

    total_all = stats_base.total + stats_anomaly.total + stats_recovery.total
    print(f"\nGrand total requests: {total_all}")


if __name__ == "__main__":
    main()
