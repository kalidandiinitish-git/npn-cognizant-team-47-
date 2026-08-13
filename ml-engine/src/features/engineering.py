"""Transaction level feature engineering (PRD FR-003).

Two code paths exist and must stay numerically identical:

* :func:`add_engineered_features` - vectorised, used by offline training.
* :func:`engineer_scalar` / :func:`feature_vector` - single record, used by the
  real-time streaming path where allocating a DataFrame per transaction would
  waste most of the 50 ms latency budget.

``tests/test_features.py`` asserts parity between the two.
"""

from __future__ import annotations

import math
from typing import Dict, Mapping

import numpy as np
import pandas as pd

from ..config import ENGINEERED_FEATURES, MODEL_FEATURES, PCA_FEATURES

SECONDS_PER_DAY = 86_400
NIGHT_END_HOUR = 6


def engineer_scalar(time_seconds: float, amount: float) -> Dict[str, float]:
    """Derive the engineered features for one transaction."""
    seconds_of_day = float(time_seconds) % SECONDS_PER_DAY
    hour_of_day = math.floor(seconds_of_day / 3600.0)
    return {
        "amount": float(amount),
        "log_amount": math.log1p(max(float(amount), 0.0)),
        "seconds_of_day": seconds_of_day,
        "hour_of_day": float(hour_of_day),
        "is_night": 1.0 if hour_of_day < NIGHT_END_HOUR else 0.0,
    }


def add_engineered_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Vectorised equivalent of :func:`engineer_scalar` for a whole frame."""
    result = frame.copy()
    amount = result["Amount"].astype("float64").clip(lower=0.0)
    seconds_of_day = result["Time"].astype("float64") % SECONDS_PER_DAY
    hour_of_day = np.floor(seconds_of_day / 3600.0)

    result["amount"] = amount
    result["log_amount"] = np.log1p(amount)
    result["seconds_of_day"] = seconds_of_day
    result["hour_of_day"] = hour_of_day
    result["is_night"] = (hour_of_day < NIGHT_END_HOUR).astype("float64")
    return result


def feature_vector(record: Mapping[str, object]) -> np.ndarray:
    """Build a single model input row in the exact MODEL_FEATURES order.

    Missing PCA components default to 0.0 so a malformed payload degrades into a
    low information prediction instead of raising (PRD PR-004 reliability).
    """
    engineered = engineer_scalar(
        _as_float(record.get("Time", record.get("time", 0.0))),
        _as_float(record.get("Amount", record.get("amount", 0.0))),
    )

    values = np.empty(len(MODEL_FEATURES), dtype=np.float64)
    for index, name in enumerate(PCA_FEATURES):
        values[index] = _as_float(record.get(name, 0.0))
    offset = len(PCA_FEATURES)
    for index, name in enumerate(ENGINEERED_FEATURES):
        values[offset + index] = engineered[name]
    return values.reshape(1, -1)


def _as_float(value: object) -> float:
    if value is None:
        return 0.0
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(result) or math.isinf(result):
        return 0.0
    return result
