"""Feature engineering parity and leakage tests."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.config import ENGINEERED_FEATURES, MODEL_FEATURES, PCA_FEATURES, TARGET_COLUMN
from src.features.engineering import add_engineered_features, engineer_scalar, feature_vector
from src.features.identity import derive_identity


def test_scalar_and_vectorised_paths_agree():
    """The streaming fast path must match the training path exactly."""
    frame = pd.DataFrame(
        {
            "Time": [0.0, 3599.0, 3600.0, 86_399.0, 86_400.0, 150_000.0],
            "Amount": [0.0, 1.0, 99.99, 2500.5, 7.25, 19_000.0],
        }
    )
    engineered = add_engineered_features(frame)

    for position in range(len(frame)):
        expected = engineer_scalar(frame.loc[position, "Time"], frame.loc[position, "Amount"])
        for name in ENGINEERED_FEATURES:
            assert engineered.loc[position, name] == pytest.approx(expected[name]), name


def test_feature_vector_shape_and_order():
    record = {name: float(index) for index, name in enumerate(PCA_FEATURES)}
    record.update({"Time": 7200.0, "Amount": 100.0})

    vector = feature_vector(record)
    assert vector.shape == (1, len(MODEL_FEATURES))

    # The PCA block keeps its declared order.
    for index, name in enumerate(PCA_FEATURES):
        assert vector[0, index] == pytest.approx(record[name])

    engineered = engineer_scalar(7200.0, 100.0)
    offset = len(PCA_FEATURES)
    for index, name in enumerate(ENGINEERED_FEATURES):
        assert vector[0, offset + index] == pytest.approx(engineered[name])


def test_feature_vector_tolerates_missing_and_invalid_values():
    vector = feature_vector({"Amount": 10.0, "V1": "not-a-number", "V2": None})
    assert vector.shape == (1, len(MODEL_FEATURES))
    assert np.isfinite(vector).all()


def test_night_flag_boundaries():
    assert engineer_scalar(0, 1)["is_night"] == 1.0
    assert engineer_scalar(5 * 3600 + 3599, 1)["is_night"] == 1.0
    assert engineer_scalar(6 * 3600, 1)["is_night"] == 0.0


def test_identity_is_deterministic_and_never_a_model_feature():
    record = {name: 0.5 for name in PCA_FEATURES}
    record.update({"Time": 10.0, "Amount": 50.0})

    first = derive_identity(record)
    second = derive_identity(dict(record))
    assert first == second, "identity derivation must be reproducible"

    for key in first:
        assert key not in MODEL_FEATURES, f"{key} must not be a model input"
    assert TARGET_COLUMN not in MODEL_FEATURES


def test_identity_varies_with_signature():
    base = {name: 0.0 for name in PCA_FEATURES}
    base.update({"Time": 0.0, "Amount": 1.0})
    other = dict(base)
    other["V1"] = 9.0

    assert derive_identity(base)["account_id"] != derive_identity(other)["account_id"]
