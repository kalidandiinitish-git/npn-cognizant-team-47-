"""Latency tests (PRD PR-001 and testing_strategy.performance_tests).

These require the serialised model, so they skip when it has not been trained.
"""

from __future__ import annotations

import statistics
from typing import List

import pytest

from src.config import LATENCY_TARGET_MS
from src.inference.predictor import FraudPredictor


@pytest.fixture(scope="module")
def predictor(request) -> FraudPredictor:
    from src.config import settings

    if not (settings.model_path.exists() and settings.preprocessor_path.exists()):
        pytest.skip("Model artifacts are missing; run python -m src.training.train first.")
    return FraudPredictor()


def percentile(ordered: List[float], value: float) -> float:
    if len(ordered) == 1:
        return ordered[0]
    rank = (value / 100.0) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def test_single_transaction_latency_is_within_target(predictor, records):
    samples = (records * 15)[:300]

    for record in samples[:25]:  # warm up
        predictor.predict(record)

    latencies = [predictor.predict(record).inference_latency_ms for record in samples]
    ordered = sorted(latencies)

    average = statistics.fmean(ordered)
    p95 = percentile(ordered, 95)
    p99 = percentile(ordered, 99)

    print(
        f"\nlatency avg={average:.3f}ms p95={p95:.3f}ms p99={p99:.3f}ms "
        f"target<{LATENCY_TARGET_MS:.0f}ms over {len(ordered)} predictions"
    )

    assert average < LATENCY_TARGET_MS, f"average {average:.2f}ms breaches the budget"
    assert p95 < LATENCY_TARGET_MS, f"p95 {p95:.2f}ms breaches the budget"


def test_every_prediction_returns_a_probability(predictor, records):
    for record in records:
        result = predictor.predict(record)
        assert 0.0 <= result.probability <= 1.0
        assert result.inference_latency_ms >= 0.0
        assert result.model_name


def test_metadata_reports_a_measured_latency(predictor):
    latency = predictor.metadata.get("latency", {})
    if not latency:
        pytest.skip("Metadata has no latency section.")
    assert latency["sample_size"] > 0
    assert latency["average_ms"] < LATENCY_TARGET_MS
    assert latency["target_ms"] == LATENCY_TARGET_MS
