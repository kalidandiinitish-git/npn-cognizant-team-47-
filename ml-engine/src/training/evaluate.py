"""Imbalance-aware evaluation, threshold tuning and latency measurement.

PRD references: FR-006 (model selection metrics), FR-007 (threshold tuning),
PR-001 (latency), testing_strategy.performance_tests.
"""

from __future__ import annotations

import statistics
import time
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_recall_curve,
    roc_auc_score,
)

from ..config import LATENCY_TARGET_MS


def classification_metrics(
    y_true: Sequence[int],
    y_probability: Sequence[float],
    threshold: float,
) -> Dict[str, object]:
    """Metrics that stay meaningful under extreme class imbalance."""
    truth = np.asarray(y_true, dtype=int)
    probability = np.asarray(y_probability, dtype=float)
    predicted = (probability >= threshold).astype(int)

    matrix = confusion_matrix(truth, predicted, labels=[0, 1])
    true_negative, false_positive, false_negative, true_positive = matrix.ravel()

    precision = (
        true_positive / (true_positive + false_positive)
        if (true_positive + false_positive)
        else 0.0
    )
    recall = (
        true_positive / (true_positive + false_negative)
        if (true_positive + false_negative)
        else 0.0
    )
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    false_positive_rate = (
        false_positive / (false_positive + true_negative)
        if (false_positive + true_negative)
        else 0.0
    )

    # PR-AUC and ROC-AUC need both classes present.
    has_both_classes = len(np.unique(truth)) == 2
    pr_auc = float(average_precision_score(truth, probability)) if has_both_classes else None
    roc_auc = float(roc_auc_score(truth, probability)) if has_both_classes else None

    return {
        "threshold": round(float(threshold), 6),
        "precision": round(float(precision), 6),
        "recall": round(float(recall), 6),
        "f1_score": round(float(f1), 6),
        "pr_auc": round(pr_auc, 6) if pr_auc is not None else None,
        "roc_auc": round(roc_auc, 6) if roc_auc is not None else None,
        "false_positive_rate": round(float(false_positive_rate), 6),
        "confusion_matrix": {
            "true_negative": int(true_negative),
            "false_positive": int(false_positive),
            "false_negative": int(false_negative),
            "true_positive": int(true_positive),
        },
        "support": {
            "total": int(truth.size),
            "fraud": int(truth.sum()),
            "legitimate": int(truth.size - truth.sum()),
        },
    }


def tune_threshold(
    y_true: Sequence[int],
    y_probability: Sequence[float],
    min_precision: float = 0.50,
    beta: float = 2.0,
) -> Tuple[float, Dict[str, object]]:
    """Choose a threshold that favours recall while keeping precision usable.

    Strategy (PRD step_6_threshold):
      1. Sweep the precision-recall curve.
      2. Keep only thresholds where precision >= ``min_precision``.
      3. Among those, maximise F-beta with beta > 1, which weights recall higher.
      4. If no threshold clears the precision floor, fall back to best F1 so the
         pipeline still produces a usable model instead of failing.
    """
    truth = np.asarray(y_true, dtype=int)
    probability = np.asarray(y_probability, dtype=float)

    precisions, recalls, thresholds = precision_recall_curve(truth, probability)
    # precision_recall_curve returns one more precision/recall than thresholds.
    precisions = precisions[:-1]
    recalls = recalls[:-1]

    if thresholds.size == 0:
        return 0.5, {"strategy": "default", "reason": "empty precision-recall curve"}

    beta_squared = beta * beta
    denominator = beta_squared * precisions + recalls
    with np.errstate(divide="ignore", invalid="ignore"):
        fbeta = np.where(
            denominator > 0,
            (1 + beta_squared) * precisions * recalls / denominator,
            0.0,
        )
        f1 = np.where(
            (precisions + recalls) > 0,
            2 * precisions * recalls / (precisions + recalls),
            0.0,
        )

    eligible = precisions >= min_precision
    if eligible.any():
        candidate_scores = np.where(eligible, fbeta, -1.0)
        best_index = int(np.argmax(candidate_scores))
        strategy = f"max_f{beta:g}_with_precision_floor"
        reason = (
            f"maximised F{beta:g} among thresholds with precision >= {min_precision:.2f}"
        )
    else:
        best_index = int(np.argmax(f1))
        strategy = "max_f1_fallback"
        reason = (
            f"no threshold reached precision {min_precision:.2f}; fell back to best F1"
        )

    # Keep the threshold strictly inside (0, 1). A threshold of exactly 1.0 only
    # fires on probabilities that are bit-for-bit 1.0, which is far too brittle
    # for a production decision boundary.
    chosen = float(min(max(thresholds[best_index], 1e-6), 0.999999))
    info = {
        "strategy": strategy,
        "reason": reason,
        "beta": beta,
        "min_precision": min_precision,
        "precision_at_threshold": round(float(precisions[best_index]), 6),
        "recall_at_threshold": round(float(recalls[best_index]), 6),
        "f1_at_threshold": round(float(f1[best_index]), 6),
        "fbeta_at_threshold": round(float(fbeta[best_index]), 6),
    }
    return chosen, info


def pr_curve_points(
    y_true: Sequence[int],
    y_probability: Sequence[float],
    max_points: int = 60,
) -> List[Dict[str, float]]:
    """Down-sampled precision-recall curve for the analytics chart."""
    truth = np.asarray(y_true, dtype=int)
    probability = np.asarray(y_probability, dtype=float)
    if len(np.unique(truth)) < 2:
        return []

    precisions, recalls, _ = precision_recall_curve(truth, probability)
    total = precisions.size
    if total <= max_points:
        indices = range(total)
    else:
        indices = np.linspace(0, total - 1, max_points).astype(int)
    return [
        {"recall": round(float(recalls[index]), 4), "precision": round(float(precisions[index]), 4)}
        for index in indices
    ]


def latency_benchmark(
    score_one: Callable[[Dict[str, float]], float],
    records: Iterable[Dict[str, float]],
    warmup: int = 20,
) -> Dict[str, object]:
    """Measure single-transaction latency through the real serving path."""
    records = list(records)
    for record in records[:warmup]:
        score_one(record)

    latencies: List[float] = []
    for record in records:
        started = time.perf_counter()
        score_one(record)
        latencies.append((time.perf_counter() - started) * 1000.0)

    if not latencies:
        return {"sample_size": 0, "target_ms": LATENCY_TARGET_MS}

    ordered = sorted(latencies)
    p95 = _percentile(ordered, 95)
    p99 = _percentile(ordered, 99)
    return {
        "sample_size": len(ordered),
        "average_ms": round(statistics.fmean(ordered), 4),
        "median_ms": round(_percentile(ordered, 50), 4),
        "p95_ms": round(p95, 4),
        "p99_ms": round(p99, 4),
        "min_ms": round(ordered[0], 4),
        "max_ms": round(ordered[-1], 4),
        "target_ms": LATENCY_TARGET_MS,
        "within_target": bool(p95 < LATENCY_TARGET_MS),
        "p99_within_target": bool(p99 < LATENCY_TARGET_MS),
    }


def _percentile(ordered: List[float], percentile: float) -> float:
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return ordered[0]
    rank = (percentile / 100.0) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight
