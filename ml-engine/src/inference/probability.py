"""Turn any estimator's output into a fraud probability in [0, 1].

Supervised models expose ``predict_proba``. Unsupervised detectors such as
Isolation Forest only expose ``decision_function`` (higher = more normal), so
their scores are squashed through a sigmoid calibrated on the training split.
Both paths live here so training and serving cannot drift apart.
"""

from __future__ import annotations

from typing import Mapping, Optional

import numpy as np


def sigmoid(values: np.ndarray) -> np.ndarray:
    """Numerically stable logistic function."""
    output = np.empty_like(values, dtype=np.float64)
    positive = values >= 0
    output[positive] = 1.0 / (1.0 + np.exp(-values[positive]))
    exponent = np.exp(values[~positive])
    output[~positive] = exponent / (1.0 + exponent)
    return output


def fraud_probability(
    estimator: object,
    matrix: np.ndarray,
    calibration: Optional[Mapping[str, float]] = None,
) -> np.ndarray:
    """Return P(fraud) for each row of ``matrix``."""
    predict_proba = getattr(estimator, "predict_proba", None)
    if callable(predict_proba):
        probabilities = np.asarray(predict_proba(matrix), dtype=np.float64)
        if probabilities.ndim == 2 and probabilities.shape[1] >= 2:
            return probabilities[:, 1]
        return probabilities.ravel()

    decision_function = getattr(estimator, "decision_function", None)
    if callable(decision_function):
        scores = np.asarray(decision_function(matrix), dtype=np.float64).ravel()
        centre = float((calibration or {}).get("center", 0.0))
        scale = float((calibration or {}).get("scale", 1.0)) or 1.0
        # decision_function is positive for inliers, so invert the sign to make
        # larger values mean "more likely fraud".
        return sigmoid(-(scores - centre) / scale)

    raise TypeError(
        f"Estimator {type(estimator).__name__} exposes neither predict_proba nor "
        "decision_function, so it cannot produce a fraud probability."
    )


def calibration_from_scores(scores: np.ndarray) -> dict:
    """Derive sigmoid calibration parameters from training decision scores."""
    array = np.asarray(scores, dtype=np.float64).ravel()
    centre = float(np.median(array))
    scale = float(np.std(array))
    if scale < 1e-9:
        scale = 1.0
    return {"center": centre, "scale": scale}
