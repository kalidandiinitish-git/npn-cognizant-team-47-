"""Feature preprocessing pipeline.

The preprocessor is fitted on the training split only and serialised to
``models/preprocessor.joblib`` (PRD step_7_serialization).
"""

from __future__ import annotations

from typing import Sequence

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ..config import MODEL_FEATURES


def build_preprocessor() -> Pipeline:
    """Median imputation followed by standardisation.

    All model inputs are numeric (28 PCA components plus engineered amount and
    time features), so a single numeric branch is enough. Keeping it inside a
    Pipeline means the fitted statistics travel with the artifact.
    """
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )


def select_features(frame: pd.DataFrame, columns: Sequence[str] = MODEL_FEATURES) -> pd.DataFrame:
    """Return the model input columns in a stable order."""
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"Frame is missing engineered feature columns: {missing}")
    return frame.loc[:, list(columns)]


def fit_preprocessor(frame: pd.DataFrame) -> Pipeline:
    preprocessor = build_preprocessor()
    preprocessor.fit(select_features(frame).to_numpy(dtype=np.float64, copy=False))
    return preprocessor


def transform_frame(preprocessor: Pipeline, frame: pd.DataFrame) -> np.ndarray:
    """Apply a fitted preprocessor to an engineered frame."""
    matrix = select_features(frame).to_numpy(dtype=np.float64, copy=False)
    return preprocessor.transform(matrix)
