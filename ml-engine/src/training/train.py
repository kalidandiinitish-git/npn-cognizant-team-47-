"""Train, compare and serialise the fraud detection model.

Run from the ml-engine directory:

    python -m src.training.train                # full dataset
    python -m src.training.train --fast         # quick pass for a smoke test
    python -m src.training.train --max-rows 50000

Implements PRD machine_learning_pipeline steps 1-7 and FR-002 to FR-007.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    IsolationForest,
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import LocalOutlierFactor
from sklearn.svm import OneClassSVM

from ..config import (
    DATA_DIR,
    ENGINEERED_FEATURES,
    LATENCY_TARGET_MS,
    MODEL_FEATURES,
    MODELS_DIR,
    PCA_FEATURES,
    RISK_BANDS,
    TARGET_COLUMN,
    TRAINING,
    ensure_directories,
    settings,
)
from ..features.engineering import add_engineered_features, feature_vector
from ..inference.probability import calibration_from_scores, fraud_probability
from ..preprocessing.loader import (
    class_distribution,
    clean_transactions,
    leakage_check,
    load_dataset,
    time_aware_split,
)
from ..preprocessing.preprocess import fit_preprocessor, transform_frame
from ..streaming.index import build_index
from .evaluate import classification_metrics, latency_benchmark, pr_curve_points, tune_threshold

logger = logging.getLogger("train")

MODEL_VERSION = "1.0.0"

try:  # XGBoost is in requirements, but the pipeline must not die without it.
    from xgboost import XGBClassifier

    HAS_XGBOOST = True
except Exception:  # pragma: no cover - depends on local wheels
    HAS_XGBOOST = False


# ---------------------------------------------------------------------------
# Candidate models (PRD FR-005)
# ---------------------------------------------------------------------------

def build_candidates(
    positive_count: int,
    negative_count: int,
    fraud_rate: float,
    random_state: int,
    fast: bool,
) -> Dict[str, Any]:
    """Instantiate the candidates with class imbalance handling built in."""
    scale_pos_weight = (negative_count / positive_count) if positive_count else 1.0
    contamination = float(min(max(fraud_rate, 1e-6), 0.5))

    candidates: Dict[str, Any] = {
        # Baseline. class_weight='balanced' reweights the loss so the ~0.17 %
        # fraud class is not drowned out.
        "logistic_regression": LogisticRegression(
            max_iter=1000,
            class_weight="balanced",
            solver="lbfgs",
            random_state=random_state,
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=80 if fast else 160,
            min_samples_leaf=3,
            max_features="sqrt",
            class_weight="balanced_subsample",
            n_jobs=-1,
            random_state=random_state,
        ),
        # --- Anomaly detectors (PRD technology_stack.anomaly_detection) -----
        # Fitted without labels, so they are the honest comparison point for
        # "can this be caught as an anomaly rather than learned as a class?".
        "isolation_forest": IsolationForest(
            n_estimators=100,
            contamination=contamination,
            max_samples=256 if fast else 4096,
            n_jobs=-1,
            random_state=random_state,
        ),
        # novelty=True keeps decision_function available at serving time; it also
        # means the fit data must be clean, which anomaly_fit_matrix enforces.
        "local_outlier_factor": LocalOutlierFactor(
            n_neighbors=20,
            novelty=True,
            n_jobs=-1,
        ),
        # nu is the assumed outlier fraction. The dataset's own fraud rate is
        # ~0.0017, low enough that the solver produces a degenerate boundary, so
        # it is floored at 1 %.
        "one_class_svm": OneClassSVM(
            kernel="rbf",
            gamma="scale",
            nu=float(min(max(contamination, 0.01), 0.5)),
        ),
    }

    if HAS_XGBOOST:
        candidates["xgboost"] = XGBClassifier(
            n_estimators=200 if fast else 400,
            max_depth=5,
            learning_rate=0.1 if fast else 0.08,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=1.0,
            tree_method="hist",
            eval_metric="aucpr",
            scale_pos_weight=scale_pos_weight,
            n_jobs=-1,
            random_state=random_state,
        )
    else:
        logger.warning("xgboost is unavailable; using HistGradientBoosting instead.")
        candidates["hist_gradient_boosting"] = HistGradientBoostingClassifier(
            max_iter=200 if fast else 400,
            learning_rate=0.1,
            class_weight="balanced",
            random_state=random_state,
        )
    return candidates


#: Candidates fitted without labels.
ANOMALY_DETECTORS = frozenset({"isolation_forest", "local_outlier_factor", "one_class_svm"})

#: The subset that are *novelty* detectors: they assume the data they are fitted
#: on contains no fraud. Isolation Forest is deliberately not one of them - it
#: takes the contaminated split as it comes and is told the contamination rate.
NOVELTY_DETECTORS = frozenset({"local_outlier_factor", "one_class_svm"})


def is_unsupervised(name: str) -> bool:
    return name in ANOMALY_DETECTORS


def anomaly_fit_matrix(
    name: str,
    x_train: np.ndarray,
    y_train: np.ndarray,
    random_state: int,
    cap: Optional[int] = None,
) -> np.ndarray:
    """The rows an unsupervised detector is actually fitted on.

    Isolation Forest sees the training split unchanged. The novelty detectors get
    a bounded random sample of the *legitimate* rows only, for two reasons:

      * correctness - a novelty detector fitted on fraud learns fraud as normal;
      * cost - LOF stores every reference point and queries them per prediction,
        and One-Class SVM training is quadratic, so an unbounded fit would break
        both the training time and the 50 ms serving budget.
    """
    if name not in NOVELTY_DETECTORS:
        return x_train

    limit = TRAINING.anomaly_fit_sample if cap is None else cap
    legitimate = np.flatnonzero(y_train == 0)
    size = int(min(limit, legitimate.size))
    if size >= legitimate.size:
        return x_train[legitimate]

    rng = np.random.default_rng(random_state)
    chosen = np.sort(rng.choice(legitimate, size=size, replace=False))
    return x_train[chosen]


# ---------------------------------------------------------------------------
# Training pipeline
# ---------------------------------------------------------------------------

def run_training(
    data_path: Optional[Path] = None,
    max_rows: Optional[int] = None,
    fast: bool = False,
    models_filter: Optional[List[str]] = None,
    latency_samples: int = TRAINING.latency_sample_size,
    write_stream_file: bool = True,
    use_smote: bool = False,
    undersample: Optional[float] = None,
) -> Dict[str, Any]:
    ensure_directories()
    started = time.time()

    # --- 1. Load -----------------------------------------------------------
    resolved = Path(data_path) if data_path else settings.resolve_dataset_path()
    if resolved is None:
        raise FileNotFoundError(
            "Could not find creditcard.csv. Set DATA_PATH in ml-engine/.env, pass "
            "--data, or place the file in ml-engine/data/."
        )
    frame = load_dataset(resolved, max_rows=max_rows)

    # --- 2. Clean ----------------------------------------------------------
    cleaned, clean_report = clean_transactions(frame)
    del frame
    logger.info("Cleaning report: %s", json.dumps(clean_report, default=str))

    # --- 3. Time aware split ----------------------------------------------
    splits = time_aware_split(cleaned)
    dataset_profile = build_dataset_profile(cleaned, clean_report, splits.stats)
    profile_path = DATA_DIR / "dataset_profile.json"
    profile_path.write_text(json.dumps(dataset_profile, indent=2), encoding="utf-8")
    logger.info("Wrote dataset profile to %s", profile_path)

    if write_stream_file:
        keep = set(PCA_FEATURES) | {"Time", "Amount", TARGET_COLUMN}
        stream_columns = [column for column in cleaned.columns if column in keep]
        stream_path = DATA_DIR / "stream_test.csv"
        splits.test.loc[:, stream_columns].to_csv(stream_path, index=False)
        logger.info(
            "Wrote held-out stream file (%s rows) to %s", f"{len(splits.test):,}", stream_path
        )
        # Index where labelled fraud sits so a demo can start near it instead of
        # waiting minutes for the first case.
        build_index(stream_path)

    del cleaned

    # --- 4. Feature engineering -------------------------------------------
    train = add_engineered_features(splits.train)
    validation = add_engineered_features(splits.validation)
    test = add_engineered_features(splits.test)

    leakage = leakage_check(list(MODEL_FEATURES))
    if not leakage["passed"]:
        raise RuntimeError(f"Leakage check failed: {leakage}")

    y_train = train[TARGET_COLUMN].to_numpy(dtype=int)
    y_validation = validation[TARGET_COLUMN].to_numpy(dtype=int)
    y_test = test[TARGET_COLUMN].to_numpy(dtype=int)

    # --- 5. Preprocessor, fitted on the training split only ----------------
    preprocessor = fit_preprocessor(train)
    x_train = transform_frame(preprocessor, train)
    x_validation = transform_frame(preprocessor, validation)
    x_test = transform_frame(preprocessor, test)

    if fast and len(x_train) > 80_000:
        # Keep every fraud row, subsample the legitimate ones.
        fraud_index = np.flatnonzero(y_train == 1)
        legit_index = np.flatnonzero(y_train == 0)
        rng = np.random.default_rng(TRAINING.random_state)
        keep_legit = rng.choice(legit_index, size=80_000 - fraud_index.size, replace=False)
        keep_rows = np.sort(np.concatenate([fraud_index, keep_legit]))
        x_train, y_train = x_train[keep_rows], y_train[keep_rows]
        logger.info("Fast mode: training on %s rows", f"{len(x_train):,}")

    # Resampling (FR-004) touches the training split only; validation and test
    # keep the real class distribution so the reported metrics stay honest.
    if undersample is not None:
        x_train, y_train = apply_undersampling(
            x_train, y_train, undersample, TRAINING.random_state
        )
    if use_smote:
        x_train, y_train = apply_smote(x_train, y_train, TRAINING.random_state)

    positives = int(y_train.sum())
    negatives = int(y_train.size - positives)
    fraud_rate = positives / max(y_train.size, 1)
    logger.info(
        "Training class balance: %s fraud / %s legitimate (%.4f %%)",
        f"{positives:,}",
        f"{negatives:,}",
        100 * fraud_rate,
    )

    # --- 6. Train and compare ---------------------------------------------
    candidates = build_candidates(positives, negatives, fraud_rate, TRAINING.random_state, fast)
    if models_filter:
        wanted = {name.strip().lower() for name in models_filter}
        candidates = {name: model for name, model in candidates.items() if name in wanted}
        if not candidates:
            raise ValueError(f"No candidate models matched {sorted(wanted)}")

    latency_records = build_latency_records(test, latency_samples)
    results: List[Dict[str, Any]] = []
    fitted: Dict[str, Any] = {}
    calibrations: Dict[str, Optional[Dict[str, float]]] = {}

    for name, estimator in candidates.items():
        logger.info("--- Training %s ---", name)
        fit_started = time.time()
        fit_matrix = x_train
        if is_unsupervised(name):
            fit_matrix = anomaly_fit_matrix(name, x_train, y_train, TRAINING.random_state)
            if fit_matrix is not x_train:
                logger.info(
                    "%s: fitting on %s legitimate rows (novelty detection)",
                    name,
                    f"{len(fit_matrix):,}",
                )
            estimator.fit(fit_matrix)
        else:
            estimator.fit(x_train, y_train)
        fit_seconds = time.time() - fit_started

        calibration = None
        if is_unsupervised(name):
            # Calibrate the sigmoid on the same rows the detector was fitted on,
            # so serving-time probabilities sit on the scale it was tuned for.
            sample = fit_matrix[: min(20_000, len(fit_matrix))]
            calibration = calibration_from_scores(estimator.decision_function(sample))
        calibrations[name] = calibration

        validation_probability = fraud_probability(estimator, x_validation, calibration)
        threshold, threshold_info = tune_threshold(
            y_validation,
            validation_probability,
            min_precision=TRAINING.min_precision,
            beta=TRAINING.fbeta_beta,
        )
        validation_metrics = classification_metrics(
            y_validation, validation_probability, threshold
        )
        latency = latency_benchmark(
            make_single_record_scorer(estimator, preprocessor, calibration),
            latency_records,
        )

        fitted[name] = estimator
        results.append(
            {
                "model_name": name,
                "estimator": type(estimator).__name__,
                "fit_seconds": round(fit_seconds, 2),
                "threshold": threshold,
                "threshold_tuning": threshold_info,
                "validation": validation_metrics,
                "latency": latency,
                "supervised": not is_unsupervised(name),
            }
        )
        logger.info(
            "%-22s PR-AUC=%s recall=%s precision=%s p95=%sms",
            name,
            validation_metrics["pr_auc"],
            validation_metrics["recall"],
            validation_metrics["precision"],
            latency.get("p95_ms"),
        )

    # --- 7. Selection (FR-006) --------------------------------------------
    best = select_best(results)
    best_name = best["model_name"]
    best_estimator = fitted[best_name]
    best_calibration = calibrations[best_name]
    threshold = float(best["threshold"])

    test_probability = fraud_probability(best_estimator, x_test, best_calibration)
    test_metrics = classification_metrics(y_test, test_probability, threshold)
    curve = pr_curve_points(y_test, test_probability)
    final_latency = latency_benchmark(
        make_single_record_scorer(best_estimator, preprocessor, best_calibration),
        latency_records,
    )

    logger.info(
        "Selected %s | test PR-AUC=%s recall=%s precision=%s | p95 latency=%sms",
        best_name,
        test_metrics["pr_auc"],
        test_metrics["recall"],
        test_metrics["precision"],
        final_latency.get("p95_ms"),
    )

    # --- 8. Serialise (step_7_serialization) ------------------------------
    model_path = MODELS_DIR / "fraud_model.joblib"
    preprocessor_path = MODELS_DIR / "preprocessor.joblib"
    metadata_path = MODELS_DIR / "model_metadata.json"

    joblib.dump(best_estimator, model_path)
    joblib.dump(preprocessor, preprocessor_path)

    metadata: Dict[str, Any] = {
        "model_name": best_name,
        "estimator": type(best_estimator).__name__,
        "version": MODEL_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "training_seconds": round(time.time() - started, 2),
        "threshold": round(threshold, 6),
        "threshold_tuning": best["threshold_tuning"],
        "risk_bands": [
            {
                "level": band.level,
                "lower": band.lower,
                "upper": min(band.upper, 1.0),
                "action": band.action,
            }
            for band in RISK_BANDS
        ],
        "feature_names": list(MODEL_FEATURES),
        "engineered_features": list(ENGINEERED_FEATURES),
        "excluded_from_model": [
            "account_id",
            "card_last4",
            "merchant",
            "merchant_category",
            "location",
            "channel",
        ],
        "anomaly_calibration": best_calibration,
        # What was actually done about the ~1:600 class ratio (FR-004), so the
        # model card and the Analytics page can state it instead of implying it.
        "imbalance_handling": {
            "class_weighting": True,
            "random_undersampling": undersample,
            "smote": bool(use_smote),
            "threshold_tuning": True,
            "evaluation": "precision-recall first (PR-AUC, precision, recall, F1)",
            "training_split_balance": {
                "fraud": positives,
                "legitimate": negatives,
                "fraud_percentage": round(100 * fraud_rate, 6),
            },
        },
        "dataset": dataset_profile,
        "metrics": {"validation": best["validation"], "test": test_metrics},
        "precision_recall_curve": curve,
        "latency": final_latency,
        "latency_target_ms": LATENCY_TARGET_MS,
        "candidates": [
            {
                key: value
                for key, value in result.items()
                if key
                in {"model_name", "estimator", "threshold", "validation", "latency", "fit_seconds"}
            }
            for result in results
        ],
        "selection": {
            # Describes what select_best actually does. "Preferably" used to
            # appear here, which read as a soft preference and left the table
            # unable to explain its own outcome: random_forest has the best
            # PR-AUC and clears the 50 ms target, yet loses on the headroom gate.
            "criteria": (
                f"p95 single-transaction latency must stay under {LATENCY_TARGET_MS:.0f} ms; "
                f"candidates keeping 2x headroom (p95 under {COMFORTABLE_LATENCY_MS:.0f} ms) "
                "are then the only ones considered, and among those the best PR-AUC wins. "
                "The headroom gate is relaxed only if no candidate clears it"
            ),
            "latency_target_ms": LATENCY_TARGET_MS,
            "comfortable_latency_ms": COMFORTABLE_LATENCY_MS,
            "selected": best_name,
        },
        "leakage_check": leakage,
        "artifacts": {
            "model": "models/fraud_model.joblib",
            "preprocessor": "models/preprocessor.joblib",
            "metadata": "models/model_metadata.json",
        },
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    logger.info("Saved artifacts to %s", MODELS_DIR)

    push_model_metrics(metadata)
    print_summary(metadata, results)
    return metadata


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_single_record_scorer(estimator, preprocessor, calibration):
    """Mirrors exactly what FraudPredictor.predict does for one record."""

    def score_one(record: Dict[str, float]) -> float:
        matrix = feature_vector(record)
        transformed = preprocessor.transform(matrix)
        return float(fraud_probability(estimator, transformed, calibration)[0])

    return score_one


def build_latency_records(test_frame: pd.DataFrame, sample_size: int) -> List[Dict[str, float]]:
    columns = list(PCA_FEATURES) + ["Time", "Amount"]
    subset = test_frame.loc[:, columns].head(max(sample_size, 1))
    return subset.to_dict("records")


#: A candidate must leave this much headroom on the latency budget to be treated
#: as comfortably real-time. A model that already eats half of the 50 ms budget on
#: an idle laptop has nothing left for a loaded production host.
LATENCY_HEADROOM_FACTOR = 2.0
COMFORTABLE_LATENCY_MS = LATENCY_TARGET_MS / LATENCY_HEADROOM_FACTOR


def select_best(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Latency is satisficing, fraud detection quality is maximising.

    PRD FR-006 asks for selection on effectiveness *and* inference latency rather
    than accuracy alone, so:

      1. Hard gate - p95 single-transaction latency must beat the 50 ms target.
      2. Comfort filter - prefer candidates whose p95 also stays under
         ``COMFORTABLE_LATENCY_MS``, i.e. at least 2x headroom.
      3. Among those, take the best PR-AUC (ties broken by lower latency).

    Chasing the absolute lowest latency would be false economy: once a model is
    an order of magnitude inside the budget, another fraction of a millisecond
    buys nothing, while PR-AUC points directly change how much fraud is caught.
    """

    def quality(result: Dict[str, Any]) -> float:
        return result["validation"].get("pr_auc") or 0.0

    def latency_p95(result: Dict[str, Any]) -> float:
        return result["latency"].get("p95_ms") or float("inf")

    gated = [result for result in results if result["latency"].get("within_target")]
    if not gated:
        logger.warning(
            "No candidate met the %.0f ms p95 latency target; falling back to the "
            "fastest available model.",
            LATENCY_TARGET_MS,
        )
        return sorted(results, key=latency_p95)[0]

    comfortable = [result for result in gated if latency_p95(result) <= COMFORTABLE_LATENCY_MS]
    pool = comfortable or gated
    if not comfortable:
        logger.warning(
            "No candidate kept %.1f ms of headroom; selecting from all models inside "
            "the hard target instead.",
            COMFORTABLE_LATENCY_MS,
        )

    chosen = sorted(pool, key=lambda result: (-quality(result), latency_p95(result)))[0]

    excluded = [
        result["model_name"] for result in gated if result not in pool and quality(result) > quality(chosen)
    ]
    if excluded:
        logger.info(
            "Excluded %s from selection: higher PR-AUC but p95 latency above the "
            "%.1f ms comfort threshold.",
            ", ".join(excluded),
            COMFORTABLE_LATENCY_MS,
        )
    return chosen


def apply_undersampling(
    x_train: np.ndarray,
    y_train: np.ndarray,
    ratio: float,
    random_state: int,
):
    """Random undersampling of the majority class (FR-004), training split only.

    ``ratio`` is the fraud-to-legitimate ratio wanted afterwards, so 0.1 leaves
    ten legitimate transactions per fraud. Every fraud row is kept - throwing
    away positives from a 0.17 % class would be self-defeating.

    Applied only to the training split. Undersampling the validation or test
    split would inflate precision by deleting the legitimate transactions the
    model is supposed to avoid flagging.
    """
    if not 0.0 < ratio <= 1.0:
        raise ValueError(f"undersampling ratio must be in (0, 1], got {ratio}")

    positives = np.flatnonzero(y_train == 1)
    negatives = np.flatnonzero(y_train == 0)
    if positives.size == 0:
        logger.warning("No fraud rows in the training split; skipping undersampling.")
        return x_train, y_train

    keep = int(round(positives.size / ratio))
    if keep >= negatives.size:
        logger.info(
            "Training split already at or below a %.3f ratio; skipping undersampling.", ratio
        )
        return x_train, y_train

    rng = np.random.default_rng(random_state)
    chosen = rng.choice(negatives, size=keep, replace=False)
    rows = np.sort(np.concatenate([positives, chosen]))
    logger.info(
        "Random undersampling: %s -> %s rows (%s fraud / %s legitimate)",
        f"{len(x_train):,}",
        f"{rows.size:,}",
        f"{positives.size:,}",
        f"{keep:,}",
    )
    return x_train[rows], y_train[rows]


def apply_smote(x_train: np.ndarray, y_train: np.ndarray, random_state: int):
    """Optional oversampling, applied to the training split only (FR-004)."""
    try:
        from imblearn.over_sampling import SMOTE
    except ImportError:
        logger.warning("imbalanced-learn is not installed; skipping SMOTE.")
        return x_train, y_train
    logger.info("Applying SMOTE to the training split")
    sampler = SMOTE(random_state=random_state, sampling_strategy=0.1)
    resampled_x, resampled_y = sampler.fit_resample(x_train, y_train)
    logger.info("SMOTE: %s -> %s rows", f"{len(x_train):,}", f"{len(resampled_x):,}")
    return resampled_x, resampled_y


def build_dataset_profile(
    frame: pd.DataFrame,
    clean_report: Dict[str, Any],
    split_stats: Dict[str, Any],
) -> Dict[str, Any]:
    """Exploratory summary for the Dataset page and the model card (phase 2)."""
    labels = frame[TARGET_COLUMN]
    amounts = frame["Amount"]
    hours = ((frame["Time"] % 86_400) // 3600).astype(int)
    hourly = hours.value_counts().sort_index()
    fraud_hourly = hours[labels == 1].value_counts().sort_index()

    correlations = (
        frame[list(PCA_FEATURES) + ["Amount"]]
        .corrwith(labels.astype(float))
        .abs()
        .sort_values(ascending=False)
        .head(10)
    )

    return {
        "source_file": "creditcard.csv",
        "rows": int(len(frame)),
        "columns": int(frame.shape[1]),
        "cleaning": clean_report,
        "class_distribution": class_distribution(labels),
        "amount": {
            "min": float(amounts.min()),
            "max": float(amounts.max()),
            "mean": round(float(amounts.mean()), 4),
            "median": float(amounts.median()),
            "p95": float(amounts.quantile(0.95)),
            "p99": float(amounts.quantile(0.99)),
            "fraud_mean": round(float(amounts[labels == 1].mean()), 4)
            if int(labels.sum())
            else None,
            "legitimate_mean": round(float(amounts[labels == 0].mean()), 4),
        },
        "time": {
            "elapsed_seconds": float(frame["Time"].max() - frame["Time"].min()),
            "span_hours": round(float((frame["Time"].max() - frame["Time"].min()) / 3600), 2),
        },
        "hourly_distribution": [
            {
                "hour": int(hour),
                "transactions": int(hourly.get(hour, 0)),
                "fraud": int(fraud_hourly.get(hour, 0)),
            }
            for hour in range(24)
        ],
        "top_absolute_correlations_with_label": [
            {"feature": str(name), "abs_correlation": round(float(value), 4)}
            for name, value in correlations.items()
        ],
        "split": split_stats,
        "missing_values": {
            str(column): int(count)
            for column, count in frame.isna().sum().items()
            if int(count) > 0
        },
    }


def push_model_metrics(metadata: Dict[str, Any]) -> None:
    """Record the evaluation run in Supabase when credentials are available."""
    if not settings.supabase_enabled:
        logger.info("Supabase not configured; skipping model_metrics upload.")
        return
    try:
        from ..persistence.supabase_client import SupabaseWriter

        test_metrics = metadata["metrics"]["test"]
        writer = SupabaseWriter()
        writer.write_model_metrics(
            {
                "model_name": metadata["model_name"],
                "version": metadata["version"],
                "precision": test_metrics["precision"],
                "recall": test_metrics["recall"],
                "f1_score": test_metrics["f1_score"],
                "pr_auc": test_metrics["pr_auc"],
                "roc_auc": test_metrics["roc_auc"],
                "average_latency_ms": metadata["latency"].get("average_ms"),
                "threshold": metadata["threshold"],
                "created_at": metadata["trained_at"],
            }
        )
        writer.close()
        logger.info("Uploaded model metrics to Supabase.")
    except Exception as error:  # pragma: no cover - network dependent
        logger.warning("Could not upload model metrics: %s", error)


def print_summary(metadata: Dict[str, Any], results: List[Dict[str, Any]]) -> None:
    line = "-" * 98
    print()
    print(line)
    print("FraudStream AI - model comparison (validation split)")
    print(line)
    print(
        f"{'model':<24}{'PR-AUC':>9}{'ROC-AUC':>9}{'prec':>9}{'recall':>9}"
        f"{'F1':>9}{'thr':>9}{'p95 ms':>9}{'fit s':>9}"
    )
    for result in sorted(
        results, key=lambda item: item["validation"].get("pr_auc") or 0, reverse=True
    ):
        validation = result["validation"]
        print(
            f"{result['model_name']:<24}"
            f"{_fmt(validation.get('pr_auc')):>9}"
            f"{_fmt(validation.get('roc_auc')):>9}"
            f"{_fmt(validation.get('precision')):>9}"
            f"{_fmt(validation.get('recall')):>9}"
            f"{_fmt(validation.get('f1_score')):>9}"
            f"{_fmt(result.get('threshold')):>9}"
            f"{_fmt(result['latency'].get('p95_ms')):>9}"
            f"{result.get('fit_seconds', 0):>9.1f}"
        )
    print(line)

    test_metrics = metadata["metrics"]["test"]
    matrix = test_metrics["confusion_matrix"]
    latency = metadata["latency"]
    print(f"Selected model      : {metadata['model_name']} ({metadata['estimator']})")
    print(
        f"Decision threshold  : {metadata['threshold']:.4f}  "
        f"[{metadata['threshold_tuning']['strategy']}]"
    )
    print(f"Test PR-AUC         : {_fmt(test_metrics['pr_auc'])}")
    print(f"Test ROC-AUC        : {_fmt(test_metrics['roc_auc'])}")
    print(f"Test precision      : {_fmt(test_metrics['precision'])}")
    print(f"Test recall         : {_fmt(test_metrics['recall'])}")
    print(f"Test F1             : {_fmt(test_metrics['f1_score'])}")
    print(f"False positive rate : {_fmt(test_metrics['false_positive_rate'])}")
    print(
        "Confusion matrix    : "
        f"TP={matrix['true_positive']} FP={matrix['false_positive']} "
        f"FN={matrix['false_negative']} TN={matrix['true_negative']}"
    )
    print(
        "Latency (1 txn)     : "
        f"avg={latency.get('average_ms')}ms p95={latency.get('p95_ms')}ms "
        f"p99={latency.get('p99_ms')}ms target<{LATENCY_TARGET_MS:.0f}ms "
        f"-> {'PASS' if latency.get('within_target') else 'FAIL'}"
    )
    print(line)
    print()


def _fmt(value: Optional[float]) -> str:
    if value is None:
        return "-"
    return f"{value:.4f}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the FraudStream AI fraud detection model."
    )
    parser.add_argument("--data", type=str, default=None, help="Path to the transaction CSV.")
    parser.add_argument("--max-rows", type=int, default=None, help="Read only the first N rows.")
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Smaller forests and a subsampled training split for a quick pass.",
    )
    parser.add_argument(
        "--models", type=str, default=None, help="Comma separated subset of candidates to train."
    )
    parser.add_argument(
        "--latency-samples",
        type=int,
        default=TRAINING.latency_sample_size,
        help="How many single-transaction predictions to time.",
    )
    parser.add_argument(
        "--no-stream-file", action="store_true", help="Do not write data/stream_test.csv."
    )
    parser.add_argument(
        "--smote",
        action="store_true",
        help="Apply SMOTE to the training split (off by default; class weights are used).",
    )
    parser.add_argument(
        "--undersample",
        type=float,
        default=None,
        metavar="RATIO",
        help=(
            "Randomly undersample legitimate transactions in the training split "
            "to the given fraud:legitimate ratio, e.g. 0.1 for 1 fraud per 10 "
            "legitimate. Every fraud row is kept. Off by default."
        ),
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    args = parse_args(argv)
    try:
        run_training(
            data_path=Path(args.data) if args.data else None,
            max_rows=args.max_rows,
            fast=args.fast,
            models_filter=args.models.split(",") if args.models else None,
            latency_samples=args.latency_samples,
            write_stream_file=not args.no_stream_file,
            use_smote=args.smote,
            undersample=args.undersample,
        )
    except Exception as error:
        logger.error("Training failed: %s", error, exc_info=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
