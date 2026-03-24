import json
from pathlib import Path

import joblib
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = PROJECT_ROOT / "ml" / "aiops_dataset.csv"
MODELS_DIR = PROJECT_ROOT / "ml" / "models"
OUTPUT_PATH = PROJECT_ROOT / "ml" / "anomaly_predictions.csv"

BASE_FEATURES = [
    "avg_latency",
    "max_latency",
    "latency_std",
    "request_rate",
    "error_rate",
    "errors_per_window",
    "endpoint_frequency",
]


def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    endpoint_dummies = pd.get_dummies(df["endpoint"], prefix="endpoint")
    return pd.concat([df[BASE_FEATURES], endpoint_dummies], axis=1)


def safe_div(numerator: float, denominator: float) -> float:
    return float(numerator / denominator) if denominator else 0.0


def main() -> None:
    required_files = [
        DATASET_PATH,
        MODELS_DIR / "isolation_forest.pkl",
        MODELS_DIR / "scaler.pkl",
        MODELS_DIR / "feature_columns.json",
    ]
    for path in required_files:
        if not path.exists():
            raise FileNotFoundError(f"Missing required file: {path}")

    df = pd.read_csv(DATASET_PATH)

    with (MODELS_DIR / "feature_columns.json").open("r", encoding="utf-8") as fh:
        feature_columns = json.load(fh)

    model = joblib.load(MODELS_DIR / "isolation_forest.pkl")
    scaler = joblib.load(MODELS_DIR / "scaler.pkl")

    X_all = build_feature_matrix(df)
    X_all = X_all.reindex(columns=feature_columns, fill_value=0)

    X_scaled = scaler.transform(X_all)

    scores = model.decision_function(X_scaled)
    raw_pred = model.predict(X_scaled)
    is_anomaly = (raw_pred == -1).astype(int)

    out_df = pd.DataFrame(
        {
            "timestamp": df["timestamp"],
            "endpoint": df["endpoint"],
            "anomaly_score": scores,
            "is_anomaly": is_anomaly,
            "is_anomaly_window": df["is_anomaly_window"].astype(int),
        }
    )

    out_df.to_csv(OUTPUT_PATH, index=False)

    tp = int(((out_df["is_anomaly"] == 1) & (out_df["is_anomaly_window"] == 1)).sum())
    fp = int(((out_df["is_anomaly"] == 1) & (out_df["is_anomaly_window"] == 0)).sum())
    fn = int(((out_df["is_anomaly"] == 0) & (out_df["is_anomaly_window"] == 1)).sum())

    precision = safe_div(tp, tp + fp)
    recall = safe_div(tp, tp + fn)
    f1 = safe_div(2 * precision * recall, precision + recall)

    print("Detection report")
    print(f"Total windows predicted as anomalous: {int(out_df['is_anomaly'].sum())}")
    print(f"True positives: {tp}")
    print(f"False positives: {fp}")
    print(f"False negatives: {fn}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall: {recall:.4f}")
    print(f"F1 score: {f1:.4f}")
    print(f"Saved predictions to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
