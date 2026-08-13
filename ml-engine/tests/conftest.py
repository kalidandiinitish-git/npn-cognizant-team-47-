"""Shared test fixtures."""

from __future__ import annotations

import csv
import random
from pathlib import Path
from typing import Dict, List

import pytest

from src.config import PCA_FEATURES, settings
from src.inference.predictor import PredictionResult


def make_row(index: int, fraud: bool = False, amount: float = 42.0) -> Dict[str, str]:
    """Build a synthetic row with the same shape as creditcard.csv."""
    rng = random.Random(index)
    row: Dict[str, str] = {"Time": str(index * 7), "Amount": f"{amount:.2f}"}
    for position, name in enumerate(PCA_FEATURES):
        base = rng.uniform(-2.0, 2.0)
        row[name] = f"{base + (3.5 if fraud and position < 4 else 0.0):.6f}"
    row["Class"] = "1" if fraud else "0"
    return row


@pytest.fixture
def sample_csv(tmp_path: Path) -> Path:
    """A 40 row CSV where every 10th record is fraud and row 5 is malformed."""
    path = tmp_path / "stream_sample.csv"
    fieldnames = ["Time"] + list(PCA_FEATURES) + ["Amount", "Class"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for index in range(1, 41):
            row = make_row(index, fraud=index % 10 == 0, amount=25.0 + index)
            if index == 5:
                row["V3"] = ""  # malformed on purpose
            writer.writerow(row)
    return path


@pytest.fixture
def records() -> List[Dict[str, float]]:
    """Model-ready records (floats, no label)."""
    output = []
    for index in range(1, 21):
        raw = make_row(index, fraud=index % 5 == 0)
        raw.pop("Class")
        output.append({key: float(value) for key, value in raw.items()})
    return output


class StubPredictor:
    """Deterministic predictor so streaming tests do not need trained artifacts.

    Probability rises with amount, which makes it easy to force a given risk band.
    """

    model_name = "stub"
    model_version = "0.0.1"
    threshold = 0.5

    def __init__(self) -> None:
        self.calls = 0

    def predict(self, record) -> PredictionResult:
        self.calls += 1
        amount = float(record.get("Amount", 0.0))
        probability = min(amount / 100.0, 0.999)
        return PredictionResult(
            probability=probability,
            inference_latency_ms=0.25,
            model_name=self.model_name,
            model_version=self.model_version,
            threshold=self.threshold,
        )

    def info(self):
        return {
            "model_name": self.model_name,
            "version": self.model_version,
            "threshold": self.threshold,
            "latency_target_ms": 50.0,
            "feature_count": 33,
            "trained_at": None,
            "metrics": {},
        }


class StubWriter:
    """Persistence stub: records nothing, reports itself as disabled."""

    enabled = False

    def stats(self):
        return {"enabled": False, "queued": 0, "succeeded": 0, "failed": 0, "dropped": 0}

    def flush(self, timeout: float = 0.0) -> None:
        return None

    def close(self, timeout: float = 0.0) -> None:
        return None


@pytest.fixture
def stub_predictor() -> StubPredictor:
    return StubPredictor()


@pytest.fixture
def stub_writer() -> StubWriter:
    return StubWriter()


@pytest.fixture
def trained_model_available() -> bool:
    return settings.model_path.exists() and settings.preprocessor_path.exists()
