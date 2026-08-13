"""Single transaction inference with latency measurement (PRD FR-009, PR-001)."""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Mapping, Optional, Tuple

import joblib
import numpy as np

from ..config import LATENCY_TARGET_MS, MODEL_FEATURES, settings
from ..features.engineering import feature_vector
from .probability import fraud_probability

logger = logging.getLogger(__name__)


class ModelNotTrainedError(RuntimeError):
    """Raised when the serialised model artifacts are missing."""


@dataclass
class PredictionResult:
    probability: float
    inference_latency_ms: float
    model_name: str
    model_version: str
    threshold: float


class FraudPredictor:
    """Loads the serialised artifacts once and scores one transaction at a time."""

    def __init__(
        self,
        model_path: Optional[Path] = None,
        preprocessor_path: Optional[Path] = None,
        metadata_path: Optional[Path] = None,
    ) -> None:
        self.model_path = Path(model_path or settings.model_path)
        self.preprocessor_path = Path(preprocessor_path or settings.preprocessor_path)
        self.metadata_path = Path(metadata_path or settings.metadata_path)

        missing = [
            str(path)
            for path in (self.model_path, self.preprocessor_path)
            if not path.exists()
        ]
        if missing:
            raise ModelNotTrainedError(
                "Model artifacts not found: "
                + ", ".join(missing)
                + ". Run: python -m src.training.train"
            )

        self.model = joblib.load(self.model_path)
        self.preprocessor = joblib.load(self.preprocessor_path)
        self.metadata: Dict[str, object] = {}
        if self.metadata_path.exists():
            self.metadata = json.loads(self.metadata_path.read_text(encoding="utf-8"))

        self.model_name = str(self.metadata.get("model_name", type(self.model).__name__))
        self.model_version = str(self.metadata.get("version", "1.0.0"))
        self.threshold = float(self.metadata.get("threshold", 0.5))
        self.calibration = self.metadata.get("anomaly_calibration") or None
        self.feature_names = list(self.metadata.get("feature_names", MODEL_FEATURES))

        logger.info(
            "Loaded model '%s' v%s (threshold=%.4f) from %s",
            self.model_name,
            self.model_version,
            self.threshold,
            self.model_path,
        )
        self._warm_up()

    def _warm_up(self) -> None:
        """First prediction pays lazy allocation costs; do it before serving."""
        blank = {name: 0.0 for name in MODEL_FEATURES}
        blank.update({"Time": 0.0, "Amount": 0.0})
        try:
            self.predict(blank)
        except Exception as error:  # pragma: no cover - defensive
            logger.warning("Model warm-up failed: %s", error)

    def predict(self, record: Mapping[str, object]) -> PredictionResult:
        """Score one transaction and measure the inference latency.

        The timed section covers exactly what the PRD calls model inference and
        processing: feature transformation plus the forward pass. Persistence and
        network I/O are measured separately by the stream processor.
        """
        started = time.perf_counter()
        matrix = feature_vector(record)
        transformed = self.preprocessor.transform(matrix)
        probability = float(
            fraud_probability(self.model, transformed, self.calibration)[0]
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0

        return PredictionResult(
            probability=probability,
            inference_latency_ms=elapsed_ms,
            model_name=self.model_name,
            model_version=self.model_version,
            threshold=self.threshold,
        )

    def explain(
        self,
        record: Mapping[str, object],
        model_probability: Optional[float] = None,
        top_n: int = 8,
    ) -> Dict[str, object]:
        """Explain an XGBoost decision with native TreeSHAP contributions.

        XGBoost returns additive contributions in raw margin/log-odds space. The
        explanation is deliberately calculated after prediction and only for
        alerting events, so it never changes the established inference latency
        measurement. Other estimators degrade to an explicit unavailable result.
        """
        started = time.perf_counter()
        try:
            get_booster = getattr(self.model, "get_booster", None)
            if get_booster is None:
                raise TypeError(f"{type(self.model).__name__} does not expose TreeSHAP contributions")

            from xgboost import DMatrix

            raw_matrix = feature_vector(record)
            transformed = self.preprocessor.transform(raw_matrix)
            values = np.asarray(transformed, dtype=np.float64).reshape(-1)
            raw_values = np.asarray(raw_matrix, dtype=np.float64).reshape(-1)
            contribution_row = np.asarray(
                get_booster().predict(DMatrix(transformed), pred_contribs=True)[0],
                dtype=np.float64,
            )
            if contribution_row.size != len(self.feature_names) + 1:
                raise ValueError(
                    f"Expected {len(self.feature_names) + 1} contributions, got "
                    f"{contribution_row.size}."
                )

            base_value = float(contribution_row[-1])
            contributions = contribution_row[:-1]
            margin = float(base_value + contributions.sum())
            reconstructed = float(1.0 / (1.0 + np.exp(-np.clip(margin, -709.0, 709.0))))
            features = [
                {
                    "name": str(name),
                    "raw_value": round(float(raw_values[index]), 6),
                    "transformed_value": round(float(values[index]), 6),
                    "contribution": round(float(contributions[index]), 8),
                    "direction": (
                        "raises_risk" if contributions[index] > 0 else "reduces_risk"
                    ),
                }
                for index, name in enumerate(self.feature_names)
            ]
            features.sort(key=lambda item: abs(float(item["contribution"])), reverse=True)
            for rank, feature in enumerate(features, start=1):
                feature["rank"] = rank

            return {
                "available": True,
                "method": "xgboost_native_tree_shap",
                "output_space": "raw_margin_log_odds",
                "base_value": round(base_value, 8),
                "margin": round(margin, 8),
                "model_probability": round(
                    float(model_probability if model_probability is not None else reconstructed), 6
                ),
                "reconstructed_probability": round(reconstructed, 6),
                "features": features[: max(int(top_n), 1)],
                "explanation_latency_ms": round(
                    (time.perf_counter() - started) * 1000.0, 3
                ),
                "model_name": self.model_name,
                "model_version": self.model_version,
            }
        except Exception as error:
            logger.warning("Model explanation unavailable: %s", error)
            return {
                "available": False,
                "method": None,
                "reason": str(error),
                "features": [],
                "explanation_latency_ms": round(
                    (time.perf_counter() - started) * 1000.0, 3
                ),
                "model_name": self.model_name,
                "model_version": self.model_version,
            }

    def predict_batch_for_benchmark(self, records) -> Tuple[np.ndarray, list]:
        """Score records one by one, returning probabilities and latencies.

        Used by the latency benchmark and tests. It deliberately loops instead of
        vectorising, because the production path is one transaction at a time.
        """
        probabilities = []
        latencies = []
        for record in records:
            result = self.predict(record)
            probabilities.append(result.probability)
            latencies.append(result.inference_latency_ms)
        return np.asarray(probabilities, dtype=np.float64), latencies

    def info(self) -> Dict[str, object]:
        metrics = self.metadata.get("metrics", {}) if isinstance(self.metadata, dict) else {}
        return {
            "model_name": self.model_name,
            "version": self.model_version,
            "threshold": self.threshold,
            "latency_target_ms": LATENCY_TARGET_MS,
            "feature_count": len(self.feature_names),
            "trained_at": self.metadata.get("trained_at"),
            "metrics": metrics,
        }


_predictor: Optional[FraudPredictor] = None
_lock = threading.Lock()


def get_predictor() -> FraudPredictor:
    """Process-wide singleton so the artifacts are only deserialised once."""
    global _predictor
    if _predictor is None:
        with _lock:
            if _predictor is None:
                _predictor = FraudPredictor()
    return _predictor


def reset_predictor() -> None:
    """Drop the cached predictor (used after retraining or in tests)."""
    global _predictor
    with _lock:
        _predictor = None
