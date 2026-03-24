from pathlib import Path
import subprocess
import sys


def run_step(project_root: Path, command: list[str], step_name: str) -> None:
    print(f"\n=== {step_name} ===")
    print("Running:", " ".join(command))
    result = subprocess.run(command, cwd=project_root)
    if result.returncode != 0:
        raise SystemExit(f"Step failed: {step_name} (exit code {result.returncode})")


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]

    steps = [
        ("Build dataset", [sys.executable, "ml/build_dataset.py"]),
        ("Train models", [sys.executable, "ml/train_model.py"]),
        ("Predict anomalies", [sys.executable, "ml/predict.py"]),
        ("Generate plots", [sys.executable, "ml/visualize.py"]),
    ]

    print("Starting Phase 3 ML pipeline...")
    print(f"Project root: {project_root}")

    for step_name, command in steps:
        run_step(project_root, command, step_name)

    print("\nPipeline completed successfully.")
    print("Outputs:")
    print("- ml/aiops_dataset.csv")
    print("- ml/anomaly_predictions.csv")
    print("- ml/models/")
    print("- ml/plots/")


if __name__ == "__main__":
    main()
