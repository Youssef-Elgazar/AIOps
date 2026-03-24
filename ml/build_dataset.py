import json
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOGS_PATH = PROJECT_ROOT / "logs.json"
GROUND_TRUTH_PATH = PROJECT_ROOT / "ground_truth.json"
OUTPUT_PATH = PROJECT_ROOT / "ml" / "aiops_dataset.csv"
WINDOW_SECONDS = 60
WINDOW_STRIDE_SECONDS = 1


def load_ground_truth_window(path: Path) -> tuple[pd.Timestamp, pd.Timestamp]:
    with path.open("r", encoding="utf-8") as fh:
        gt = json.load(fh)

    anomaly_start = pd.to_datetime(gt["anomaly_start_iso"], utc=True)
    anomaly_end = pd.to_datetime(gt["anomaly_end_iso"], utc=True)
    return anomaly_start, anomaly_end


def main() -> None:
    if not LOGS_PATH.exists():
        raise FileNotFoundError(f"Missing input file: {LOGS_PATH}")
    if not GROUND_TRUTH_PATH.exists():
        raise FileNotFoundError(f"Missing input file: {GROUND_TRUTH_PATH}")

    logs_df = pd.read_json(LOGS_PATH)

    # Keep only request-completed records, or infer from available latency.
    message_col = logs_df.get("message")
    has_completed_message = message_col.eq("request_completed") if message_col is not None else pd.Series(False, index=logs_df.index)
    has_latency = logs_df.get("latency_ms").notna() if "latency_ms" in logs_df.columns else pd.Series(False, index=logs_df.index)
    df = logs_df[has_completed_message | has_latency].copy()

    if df.empty:
        raise ValueError("No request-completed records found in logs.json")

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df.dropna(subset=["timestamp"]).copy()

    # Ensure numeric latency and status columns are safe for aggregation.
    df["latency_ms"] = pd.to_numeric(df.get("latency_ms"), errors="coerce")
    df["status_code"] = pd.to_numeric(df.get("status_code"), errors="coerce")

    df["endpoint"] = df.get("route_name").fillna("unknown").replace("", "unknown")

    severity_error = df.get("severity").astype(str).str.lower().eq("error") if "severity" in df.columns else pd.Series(False, index=df.index)
    status_error = df["status_code"].ge(400).fillna(False)
    category_error = df.get("error_category").notna() if "error_category" in df.columns else pd.Series(False, index=df.index)
    df["is_error"] = (severity_error | status_error | category_error).astype(int)

    event_seconds = df["timestamp"].dt.floor("s")
    offsets = np.arange(WINDOW_SECONDS, dtype="int64")

    expanded = df.loc[df.index.repeat(WINDOW_SECONDS)].copy()
    event_seconds_np = event_seconds.to_numpy(dtype="datetime64[s]")
    expanded_window_np = event_seconds_np.repeat(WINDOW_SECONDS) - np.tile(offsets, len(df)).astype("timedelta64[s]")
    expanded["window_start"] = pd.to_datetime(expanded_window_np, utc=True)

    grouped = (
        expanded.groupby(["window_start", "endpoint"], as_index=False)
        .agg(
            avg_latency=("latency_ms", "mean"),
            max_latency=("latency_ms", "max"),
            latency_std=("latency_ms", "std"),
            total_requests=("latency_ms", "count"),
            errors_per_window=("is_error", "sum"),
        )
    )

    # Build full (window_start, endpoint) combinations so each window has one row per endpoint.
    all_windows = pd.date_range(
        start=expanded["window_start"].min(),
        end=expanded["window_start"].max(),
        freq=f"{WINDOW_STRIDE_SECONDS}s",
        tz="UTC",
    )
    all_endpoints = sorted(df["endpoint"].dropna().unique().tolist())
    full_index = pd.MultiIndex.from_product(
        [all_windows, all_endpoints], names=["window_start", "endpoint"]
    )
    grouped = (
        grouped.set_index(["window_start", "endpoint"])
        .reindex(full_index)
        .reset_index()
    )

    grouped["total_requests"] = grouped["total_requests"].fillna(0).astype(int)
    grouped["errors_per_window"] = grouped["errors_per_window"].fillna(0).astype(int)
    grouped["avg_latency"] = grouped["avg_latency"].fillna(0.0)
    grouped["max_latency"] = grouped["max_latency"].fillna(0.0)
    grouped["latency_std"] = grouped["latency_std"].fillna(0.0)
    grouped["request_rate"] = grouped["total_requests"] / WINDOW_SECONDS
    grouped["error_rate"] = np.where(
        grouped["total_requests"] > 0,
        grouped["errors_per_window"] / grouped["total_requests"],
        0.0,
    )

    total_per_window = grouped.groupby("window_start")["total_requests"].transform("sum")
    grouped["endpoint_frequency"] = np.where(
        total_per_window > 0,
        grouped["total_requests"] / total_per_window,
        0.0,
    )

    anomaly_start, anomaly_end = load_ground_truth_window(GROUND_TRUTH_PATH)
    window_end = grouped["window_start"] + pd.to_timedelta(WINDOW_SECONDS, unit="s")
    overlaps = (grouped["window_start"] < anomaly_end) & (window_end > anomaly_start)
    grouped["is_anomaly_window"] = overlaps.astype(int)

    grouped = grouped.rename(columns={"window_start": "timestamp"})
    grouped["timestamp"] = grouped["timestamp"].apply(lambda ts: ts.isoformat())

    output_df = grouped[
        [
            "timestamp",
            "endpoint",
            "avg_latency",
            "max_latency",
            "latency_std",
            "request_rate",
            "error_rate",
            "errors_per_window",
            "endpoint_frequency",
            "is_anomaly_window",
        ]
    ].sort_values(["timestamp", "endpoint"], ignore_index=True)

    if len(output_df) < 1500:
        raise ValueError(
            f"Dataset has {len(output_df)} rows, below minimum required size of 1500"
        )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    output_df.to_csv(OUTPUT_PATH, index=False)

    print(f"Saved dataset to: {OUTPUT_PATH}")
    print(f"Total rows: {len(output_df)}")
    print(f"Unique endpoints: {output_df['endpoint'].nunique()}")
    print(f"Anomaly-window rows: {int(output_df['is_anomaly_window'].sum())}")


if __name__ == "__main__":
    main()
