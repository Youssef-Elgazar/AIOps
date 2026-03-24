import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = PROJECT_ROOT / "ml" / "aiops_dataset.csv"
MODELS_DIR = PROJECT_ROOT / "ml" / "models"

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


def main() -> None:
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Missing dataset file: {DATASET_PATH}")

    df = pd.read_csv(DATASET_PATH)

    missing = [col for col in BASE_FEATURES + ["endpoint", "is_anomaly_window"] if col not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")

    X_all = build_feature_matrix(df)
    feature_columns = X_all.columns.tolist()

    train_mask = df["is_anomaly_window"].eq(0)
    if not train_mask.any():
        raise ValueError("No normal rows available for training")

    X_train = X_all.loc[train_mask]
    X_test = X_all

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    isolation_forest = IsolationForest(
        contamination=0.05,
        n_estimators=200,
        random_state=42,
        max_samples="auto",
    )
    oneclass_svm = OneClassSVM(kernel="rbf", nu=0.05)

    isolation_forest.fit(X_train_scaled)
    oneclass_svm.fit(X_train_scaled)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(isolation_forest, MODELS_DIR / "isolation_forest.pkl")
    joblib.dump(oneclass_svm, MODELS_DIR / "oneclass_svm.pkl")
    joblib.dump(scaler, MODELS_DIR / "scaler.pkl")

    with (MODELS_DIR / "feature_columns.json").open("w", encoding="utf-8") as fh:
        json.dump(feature_columns, fh, indent=2)

    anomaly_rows_test = int(df["is_anomaly_window"].sum())

    print("Training summary")
    print(f"Training samples (normal only): {X_train_scaled.shape[0]}")
    print(f"Test samples (all rows): {X_test_scaled.shape[0]}")
    print(f"Anomaly-window rows in test set: {anomaly_rows_test}")
    print(f"Saved models and metadata to: {MODELS_DIR}")


if __name__ == "__main__":
    main()
