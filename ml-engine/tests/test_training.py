"""Tests for the model comparison and class imbalance handling (FR-004 to FR-006).

These cover the parts of the training pipeline that can run without the raw
``creditcard.csv``: which candidates exist, how the unsupervised detectors are
fitted, and that the resampling helpers only ever touch the training split.
"""

from __future__ import annotations

import numpy as np
import pytest

from src.config import TRAINING
from src.inference.probability import calibration_from_scores, fraud_probability
from src.training.train import (
    ANOMALY_DETECTORS,
    NOVELTY_DETECTORS,
    anomaly_fit_matrix,
    apply_undersampling,
    build_candidates,
    is_unsupervised,
)


@pytest.fixture
def imbalanced_split():
    """A small, strongly imbalanced training split: 1 000 legit, 20 fraud."""
    rng = np.random.default_rng(0)
    legitimate = rng.normal(0.0, 1.0, size=(1_000, 6))
    fraud = rng.normal(4.0, 1.0, size=(20, 6))
    x = np.vstack([legitimate, fraud])
    y = np.concatenate([np.zeros(1_000, dtype=int), np.ones(20, dtype=int)])
    return x, y


# ---------------------------------------------------------------------------
# Candidate line-up (FR-005, PRD technology_stack.ml_engine.anomaly_detection)
# ---------------------------------------------------------------------------

def test_candidates_cover_every_prd_model_family():
    candidates = build_candidates(
        positive_count=20, negative_count=1_000, fraud_rate=0.02, random_state=0, fast=True
    )
    # Supervised baseline + ensembles, and all three PRD anomaly detectors.
    for name in ("logistic_regression", "random_forest", "isolation_forest",
                 "local_outlier_factor", "one_class_svm"):
        assert name in candidates, f"{name} is missing from the candidate line-up"
    # XGBoost is the PRD's headline model; it is only absent if the wheel is not
    # installed, in which case a boosting stand-in must take its place.
    assert "xgboost" in candidates or "hist_gradient_boosting" in candidates


def test_anomaly_detectors_are_flagged_unsupervised():
    for name in ANOMALY_DETECTORS:
        assert is_unsupervised(name)
    for name in ("logistic_regression", "random_forest", "xgboost"):
        assert not is_unsupervised(name)


# ---------------------------------------------------------------------------
# How the unsupervised detectors are fitted
# ---------------------------------------------------------------------------

def test_novelty_detectors_fit_on_bounded_legitimate_rows_only(imbalanced_split):
    x, y = imbalanced_split
    for name in NOVELTY_DETECTORS:
        matrix = anomaly_fit_matrix(name, x, y, random_state=0, cap=100)
        assert len(matrix) == 100
        # Every selected row must come from the legitimate half of the split:
        # a novelty detector fitted on fraud learns fraud as normal.
        legitimate_rows = {tuple(row) for row in x[y == 0]}
        assert all(tuple(row) in legitimate_rows for row in matrix)


def test_novelty_fit_matrix_never_exceeds_available_legitimate_rows(imbalanced_split):
    x, y = imbalanced_split
    matrix = anomaly_fit_matrix("one_class_svm", x, y, random_state=0, cap=10_000)
    assert len(matrix) == int((y == 0).sum())


def test_isolation_forest_keeps_the_full_contaminated_split(imbalanced_split):
    x, y = imbalanced_split
    matrix = anomaly_fit_matrix("isolation_forest", x, y, random_state=0, cap=100)
    assert matrix is x


@pytest.mark.parametrize("name", sorted(ANOMALY_DETECTORS))
def test_every_anomaly_detector_produces_a_usable_fraud_probability(name, imbalanced_split):
    """The serving path only knows decision_function; each detector must fit it."""
    x, y = imbalanced_split
    estimator = build_candidates(20, 1_000, 0.02, random_state=0, fast=True)[name]
    fit_matrix = anomaly_fit_matrix(name, x, y, random_state=0, cap=200)
    estimator.fit(fit_matrix)

    calibration = calibration_from_scores(estimator.decision_function(fit_matrix))
    probabilities = fraud_probability(estimator, x, calibration)

    assert probabilities.shape == (len(x),)
    assert np.all((probabilities >= 0.0) & (probabilities <= 1.0))
    # A detector that cannot separate a well-separated synthetic fraud cluster is
    # miswired (inverted sign, wrong calibration), not merely weak.
    assert probabilities[y == 1].mean() > probabilities[y == 0].mean()


# ---------------------------------------------------------------------------
# Class imbalance handling (FR-004)
# ---------------------------------------------------------------------------

def test_undersampling_keeps_every_fraud_row_and_hits_the_target_ratio(imbalanced_split):
    x, y = imbalanced_split
    resampled_x, resampled_y = apply_undersampling(x, y, ratio=0.5, random_state=0)

    assert int(resampled_y.sum()) == int(y.sum()), "undersampling must not drop fraud rows"
    positives = int(resampled_y.sum())
    negatives = int(resampled_y.size - positives)
    assert positives / negatives == pytest.approx(0.5, abs=0.05)
    assert len(resampled_x) == len(resampled_y)


def test_undersampling_is_a_no_op_when_the_split_is_already_balanced(imbalanced_split):
    x, y = imbalanced_split
    resampled_x, resampled_y = apply_undersampling(x, y, ratio=0.001, random_state=0)
    assert len(resampled_x) == len(x)
    assert int(resampled_y.sum()) == int(y.sum())


def test_undersampling_rejects_a_ratio_outside_the_unit_interval(imbalanced_split):
    x, y = imbalanced_split
    with pytest.raises(ValueError):
        apply_undersampling(x, y, ratio=1.5, random_state=0)


def test_anomaly_fit_sample_default_is_configured():
    assert TRAINING.anomaly_fit_sample > 0
