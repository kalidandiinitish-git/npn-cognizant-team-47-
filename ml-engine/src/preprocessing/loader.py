"""Dataset loading, cleaning and time aware splitting.

Implements PRD machine_learning_pipeline.step_2_preprocessing and step_3_split.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from ..config import (
    PCA_FEATURES,
    RAW_REQUIRED_COLUMNS,
    TARGET_COLUMN,
    TRAINING,
    TrainingConfig,
)

logger = logging.getLogger(__name__)


@dataclass
class DatasetSplits:
    """Train / validation / test frames produced by a time aware split."""

    train: pd.DataFrame
    validation: pd.DataFrame
    test: pd.DataFrame
    stats: Dict[str, object] = field(default_factory=dict)

    def describe(self) -> str:
        return (
            f"train={len(self.train):,} rows "
            f"(fraud={int(self.train[TARGET_COLUMN].sum()):,}) | "
            f"validation={len(self.validation):,} rows "
            f"(fraud={int(self.validation[TARGET_COLUMN].sum()):,}) | "
            f"test={len(self.test):,} rows "
            f"(fraud={int(self.test[TARGET_COLUMN].sum()):,})"
        )


def _read_csv(path: Path, max_rows: Optional[int]) -> pd.DataFrame:
    dtypes = {column: "float32" for column in PCA_FEATURES}
    dtypes["Time"] = "float64"
    dtypes["Amount"] = "float64"
    frame = pd.read_csv(path, dtype=dtypes, nrows=max_rows)
    return frame


def load_dataset(
    path: Path,
    max_rows: Optional[int] = None,
    require_target: bool = True,
) -> pd.DataFrame:
    """Read the transaction dataset from disk and validate its schema."""
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {path}. Set DATA_PATH in ml-engine/.env or place "
            "creditcard.csv in ml-engine/data/."
        )

    logger.info("Loading dataset from %s", path)
    frame = _read_csv(path, max_rows)

    missing = [column for column in RAW_REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(
            "Dataset is missing required columns: " + ", ".join(missing) +
            f". Found columns: {list(frame.columns)[:8]}..."
        )
    if require_target and TARGET_COLUMN not in frame.columns:
        raise ValueError(
            f"Dataset is missing the '{TARGET_COLUMN}' label column, which is required "
            "for supervised training."
        )
    logger.info("Loaded %s rows x %s columns", f"{len(frame):,}", frame.shape[1])
    return frame


def clean_transactions(frame: pd.DataFrame) -> tuple[pd.DataFrame, Dict[str, object]]:
    """Clean the raw frame and report what was changed.

    Steps (PRD step_2_preprocessing):
      1. Remove duplicate records.
      2. Drop rows with missing values in required columns.
      3. Validate numerical ranges (no negative Amount or Time).
      4. Coerce the target label to integers.
    """
    report: Dict[str, object] = {"rows_in": int(len(frame))}
    cleaned = frame.copy()

    before = len(cleaned)
    cleaned = cleaned.drop_duplicates()
    report["duplicates_removed"] = int(before - len(cleaned))

    required = [column for column in RAW_REQUIRED_COLUMNS if column in cleaned.columns]
    before = len(cleaned)
    cleaned = cleaned.dropna(subset=required)
    report["rows_with_missing_values_dropped"] = int(before - len(cleaned))

    before = len(cleaned)
    cleaned = cleaned[(cleaned["Amount"] >= 0) & (cleaned["Time"] >= 0)]
    report["out_of_range_rows_dropped"] = int(before - len(cleaned))

    if TARGET_COLUMN in cleaned.columns:
        cleaned[TARGET_COLUMN] = (
            pd.to_numeric(cleaned[TARGET_COLUMN], errors="coerce").fillna(0).astype("int8")
        )
        fraud_count = int(cleaned[TARGET_COLUMN].sum())
        report["fraud_rows"] = fraud_count
        report["legitimate_rows"] = int(len(cleaned) - fraud_count)
        report["fraud_rate"] = float(fraud_count / len(cleaned)) if len(cleaned) else 0.0
        report["imbalance_ratio"] = (
            float((len(cleaned) - fraud_count) / fraud_count) if fraud_count else None
        )

    cleaned = cleaned.reset_index(drop=True)
    report["rows_out"] = int(len(cleaned))
    report["amount_min"] = float(cleaned["Amount"].min()) if len(cleaned) else 0.0
    report["amount_max"] = float(cleaned["Amount"].max()) if len(cleaned) else 0.0
    report["amount_mean"] = float(cleaned["Amount"].mean()) if len(cleaned) else 0.0
    report["time_min"] = float(cleaned["Time"].min()) if len(cleaned) else 0.0
    report["time_max"] = float(cleaned["Time"].max()) if len(cleaned) else 0.0
    return cleaned, report


def time_aware_split(
    frame: pd.DataFrame,
    config: TrainingConfig = TRAINING,
) -> DatasetSplits:
    """Split chronologically so no future transaction leaks into training.

    The dataset stores ``Time`` as seconds elapsed since the first transaction,
    so sorting by ``Time`` reproduces the original event order.
    """
    ordered = frame.sort_values("Time", kind="mergesort").reset_index(drop=True)

    total = len(ordered)
    train_end = int(total * config.train_fraction)
    validation_end = train_end + int(total * config.validation_fraction)

    train = ordered.iloc[:train_end].copy()
    validation = ordered.iloc[train_end:validation_end].copy()
    test = ordered.iloc[validation_end:].copy()

    stats: Dict[str, object] = {
        "split_method": "time_aware",
        "total_rows": int(total),
        "train_rows": int(len(train)),
        "validation_rows": int(len(validation)),
        "test_rows": int(len(test)),
        "train_time_range": [float(train["Time"].min()), float(train["Time"].max())],
        "validation_time_range": [
            float(validation["Time"].min()),
            float(validation["Time"].max()),
        ],
        "test_time_range": [float(test["Time"].min()), float(test["Time"].max())],
    }
    if TARGET_COLUMN in ordered.columns:
        stats["train_fraud"] = int(train[TARGET_COLUMN].sum())
        stats["validation_fraud"] = int(validation[TARGET_COLUMN].sum())
        stats["test_fraud"] = int(test[TARGET_COLUMN].sum())

    splits = DatasetSplits(train=train, validation=validation, test=test, stats=stats)
    logger.info("Time aware split -> %s", splits.describe())
    return splits


def class_distribution(labels: "pd.Series | np.ndarray") -> Dict[str, object]:
    """Summarise class imbalance for reporting (PRD testing_strategy.model_tests)."""
    values = np.asarray(labels)
    total = int(values.size)
    positives = int(values.sum())
    negatives = total - positives
    return {
        "total": total,
        "fraud": positives,
        "legitimate": negatives,
        "fraud_percentage": round(100.0 * positives / total, 4) if total else 0.0,
        "negative_to_positive_ratio": round(negatives / positives, 2) if positives else None,
    }


def leakage_check(feature_columns: List[str]) -> Dict[str, object]:
    """Assert the target never appears among model inputs."""
    offenders = [column for column in feature_columns if column.lower() in {"class", "is_fraud", "label"}]
    return {"passed": not offenders, "offending_columns": offenders}
