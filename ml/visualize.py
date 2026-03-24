import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.lines import Line2D

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = PROJECT_ROOT / "ml" / "aiops_dataset.csv"
PREDICTIONS_PATH = PROJECT_ROOT / "ml" / "anomaly_predictions.csv"
GROUND_TRUTH_PATH = PROJECT_ROOT / "ground_truth.json"
PLOTS_DIR = PROJECT_ROOT / "ml" / "plots"


def load_ground_truth_window(path: Path) -> tuple[pd.Timestamp, pd.Timestamp]:
    with path.open("r", encoding="utf-8") as fh:
        gt = json.load(fh)

    anomaly_start = pd.to_datetime(gt["anomaly_start_iso"], utc=True)
    anomaly_end = pd.to_datetime(gt["anomaly_end_iso"], utc=True)
    return anomaly_start, anomaly_end


def style_time_axis(ax) -> None:
    for label in ax.get_xticklabels():
        label.set_rotation(45)
        label.set_horizontalalignment("right")


def plot_latency_timeline(dataset_df: pd.DataFrame, anomaly_start: pd.Timestamp, anomaly_end: pd.Timestamp) -> None:
    fig, ax = plt.subplots(figsize=(14, 5))

    for endpoint, group in dataset_df.groupby("endpoint"):
        ax.plot(group["timestamp"], group["avg_latency"], label=endpoint)

    ax.axvspan(anomaly_start, anomaly_end, color="red", alpha=0.15, label="Anomaly window")
    ax.set_title("Average Latency per Endpoint")
    ax.set_xlabel("timestamp")
    ax.set_ylabel("latency (ms)")
    style_time_axis(ax)
    ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0))
    plt.tight_layout()

    output_path = PLOTS_DIR / "latency_timeline.png"
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def plot_error_rate_timeline(dataset_df: pd.DataFrame, anomaly_start: pd.Timestamp, anomaly_end: pd.Timestamp) -> None:
    fig, ax = plt.subplots(figsize=(14, 5))

    for endpoint, group in dataset_df.groupby("endpoint"):
        ax.plot(group["timestamp"], group["error_rate"], label=endpoint)

    ax.axvspan(anomaly_start, anomaly_end, color="red", alpha=0.15, label="Anomaly window")
    ax.set_title("Error Rate per Endpoint")
    ax.set_xlabel("timestamp")
    ax.set_ylabel("error rate (0-1)")
    style_time_axis(ax)
    ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0))
    plt.tight_layout()

    output_path = PLOTS_DIR / "error_rate_timeline.png"
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def plot_anomaly_detection(predictions_df: pd.DataFrame, anomaly_start: pd.Timestamp, anomaly_end: pd.Timestamp) -> None:
    fig, ax = plt.subplots(figsize=(14, 5))

    colors = predictions_df["is_anomaly"].map({0: "blue", 1: "red"})
    ax.scatter(predictions_df["timestamp"], predictions_df["anomaly_score"], c=colors, alpha=0.7, s=20)

    ax.axhline(0, color="black", linestyle="--", linewidth=1, label="Decision threshold (0)")
    ax.axvspan(anomaly_start, anomaly_end, color="red", alpha=0.15, label="Anomaly window")

    ax.set_title("Isolation Forest Anomaly Scores")
    ax.set_xlabel("timestamp")
    ax.set_ylabel("anomaly score")
    style_time_axis(ax)

    legend_handles = [
        Line2D([0], [0], marker="o", color="w", markerfacecolor="blue", markersize=7, label="Normal"),
        Line2D([0], [0], marker="o", color="w", markerfacecolor="red", markersize=7, label="Anomaly"),
        Line2D([0], [0], color="black", linestyle="--", linewidth=1, label="Decision threshold (0)"),
        Line2D([0], [0], color="red", linewidth=6, alpha=0.15, label="Anomaly window"),
    ]
    ax.legend(handles=legend_handles, loc="upper left", bbox_to_anchor=(1.02, 1.0))
    plt.tight_layout()

    output_path = PLOTS_DIR / "anomaly_detection.png"
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def main() -> None:
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Missing dataset file: {DATASET_PATH}")
    if not PREDICTIONS_PATH.exists():
        raise FileNotFoundError(f"Missing predictions file: {PREDICTIONS_PATH}")
    if not GROUND_TRUTH_PATH.exists():
        raise FileNotFoundError(f"Missing ground truth file: {GROUND_TRUTH_PATH}")

    dataset_df = pd.read_csv(DATASET_PATH)
    predictions_df = pd.read_csv(PREDICTIONS_PATH)

    dataset_df["timestamp"] = pd.to_datetime(dataset_df["timestamp"], utc=True, errors="coerce")
    predictions_df["timestamp"] = pd.to_datetime(predictions_df["timestamp"], utc=True, errors="coerce")

    dataset_df = dataset_df.dropna(subset=["timestamp"])
    predictions_df = predictions_df.dropna(subset=["timestamp"])

    dataset_df = dataset_df.sort_values("timestamp")
    predictions_df = predictions_df.sort_values("timestamp")

    anomaly_start, anomaly_end = load_ground_truth_window(GROUND_TRUTH_PATH)

    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    plot_latency_timeline(dataset_df, anomaly_start, anomaly_end)
    plot_error_rate_timeline(dataset_df, anomaly_start, anomaly_end)
    plot_anomaly_detection(predictions_df, anomaly_start, anomaly_end)

    print(f"Saved plots to: {PLOTS_DIR}")


if __name__ == "__main__":
    main()
