"""Risk engine: transaction risk bands and account level aggregation.

Implements PRD ``risk_engine``, FR-007 (threshold tuning bands), FR-010 (alerting)
and FR-011 (high risk account detection).
"""

from __future__ import annotations

import math
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Iterable, List, Mapping, Optional, Tuple

from ..config import (
    ACCOUNT_RISK_BANDS,
    ALERT_RISK_SCORE,
    RISK_BANDS,
    RiskBand,
)

# ---------------------------------------------------------------------------
# Transaction level risk
# ---------------------------------------------------------------------------

#: The risk score at which a tuned decision threshold is anchored. Mapping the
#: model's raw probability so that "threshold" lands exactly on the start of the
#: "high" band keeps the PRD risk bands consistent with the tuned threshold.
ANCHOR_RISK_SCORE = 0.70


def probability_to_risk_score(probability: float, threshold: float) -> float:
    """Map a raw fraud probability onto the PRD risk score scale.

    A model trained with class weights produces probabilities that are not
    directly comparable to the fixed 0.40 / 0.70 / 0.90 band edges. This applies a
    monotonic, piecewise-linear rescaling so that:

      * ``probability == 0``          -> 0.00
      * ``probability == threshold``  -> 0.70 (start of the "high" band)
      * ``probability == 1``          -> 1.00

    Monotonic means the ordering of transactions by risk never changes, so no
    ranking information is lost.
    """
    probability = _clamp(probability, 0.0, 1.0)
    threshold = _clamp(threshold, 1e-6, 1.0 - 1e-6)

    if probability <= threshold:
        score = ANCHOR_RISK_SCORE * (probability / threshold)
    else:
        score = ANCHOR_RISK_SCORE + (1.0 - ANCHOR_RISK_SCORE) * (
            (probability - threshold) / (1.0 - threshold)
        )
    return round(_clamp(score, 0.0, 1.0), 6)


def classify_risk(score: float, bands: Iterable[RiskBand] = RISK_BANDS) -> RiskBand:
    """Return the risk band a score falls into."""
    score = _clamp(score, 0.0, 1.0)
    selected = None
    for band in bands:
        if band.lower <= score < band.upper:
            selected = band
            break
    if selected is None:  # score == 1.0 falls through the half-open intervals
        selected = list(bands)[-1]
    return selected


@dataclass
class RiskAssessment:
    """Outcome of scoring a single transaction."""

    probability: float
    risk_score: float
    risk_level: str
    action: str
    is_fraud_prediction: bool
    alert_required: bool

    def as_dict(self) -> Dict[str, object]:
        return {
            "probability": self.probability,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level,
            "action": self.action,
            "is_fraud_prediction": self.is_fraud_prediction,
            "alert_required": self.alert_required,
        }


def assess(probability: float, threshold: float) -> RiskAssessment:
    """Turn a model probability into a full risk decision."""
    risk_score = probability_to_risk_score(probability, threshold)
    band = classify_risk(risk_score)
    return RiskAssessment(
        probability=round(_clamp(probability, 0.0, 1.0), 6),
        risk_score=risk_score,
        risk_level=band.level,
        action=band.action,
        is_fraud_prediction=probability >= threshold,
        alert_required=risk_score >= ALERT_RISK_SCORE,
    )


# ---------------------------------------------------------------------------
# Account level risk
# ---------------------------------------------------------------------------

VELOCITY_WINDOW_SECONDS = 3_600
RECENT_EVENT_LIMIT = 64
HIGH_VALUE_AMOUNT = 500.0

#: Weighted combination used for the account risk score (PRD risk_engine.account_risk).
ACCOUNT_RISK_WEIGHTS: Dict[str, float] = {
    "average_risk": 0.30,
    "maximum_risk": 0.15,
    "suspicious_ratio": 0.20,
    "velocity": 0.10,
    "high_value_ratio": 0.10,
    "geo_anomaly": 0.08,
    "merchant_anomaly": 0.07,
}


@dataclass
class BehaviouralFeatures:
    """Account context for a transaction, computed from prior activity only."""

    account_transaction_count: int
    account_average_amount: float
    amount_deviation: float
    seconds_since_previous: Optional[float]
    transaction_velocity_1h: int
    distinct_locations_recent: int
    is_high_value: bool

    def as_dict(self) -> Dict[str, object]:
        return {
            "account_transaction_count": self.account_transaction_count,
            "account_average_amount": round(self.account_average_amount, 2),
            "amount_deviation": round(self.amount_deviation, 4),
            "seconds_since_previous": (
                round(self.seconds_since_previous, 2)
                if self.seconds_since_previous is not None
                else None
            ),
            "transaction_velocity_1h": self.transaction_velocity_1h,
            "distinct_locations_recent": self.distinct_locations_recent,
            "is_high_value": self.is_high_value,
        }


@dataclass
class AccountProfile:
    """Running risk state for one account."""

    account_id: str
    transaction_count: int = 0
    suspicious_count: int = 0
    high_value_count: int = 0
    risk_sum: float = 0.0
    maximum_risk_score: float = 0.0
    last_activity: Optional[str] = None
    last_event_time: Optional[float] = None
    risk_score: float = 0.0
    risk_level: str = "low"

    # Internal running statistics (Welford) and recent-event windows.
    _amount_mean: float = 0.0
    _amount_m2: float = 0.0
    _event_times: Deque[float] = field(default_factory=lambda: deque(maxlen=RECENT_EVENT_LIMIT))
    _locations: Deque[str] = field(default_factory=lambda: deque(maxlen=RECENT_EVENT_LIMIT))
    _suspicious_categories: Counter = field(default_factory=Counter)

    @property
    def average_risk_score(self) -> float:
        if not self.transaction_count:
            return 0.0
        return self.risk_sum / self.transaction_count

    @property
    def amount_standard_deviation(self) -> float:
        if self.transaction_count < 2:
            return 0.0
        return math.sqrt(self._amount_m2 / (self.transaction_count - 1))

    def as_dict(self) -> Dict[str, object]:
        return {
            "account_id": self.account_id,
            "transaction_count": self.transaction_count,
            "suspicious_count": self.suspicious_count,
            "average_risk_score": round(self.average_risk_score, 6),
            "maximum_risk_score": round(self.maximum_risk_score, 6),
            "risk_score": round(self.risk_score, 6),
            "risk_level": self.risk_level,
            "last_activity": self.last_activity,
        }


class AccountRiskEngine:
    """Aggregates streamed transactions into account level risk.

    The engine is intentionally in-memory and single threaded: the pseudo-stream
    processes one transaction at a time, so there is no contention. Swapping this
    for Redis later would not change the interface.
    """

    def __init__(self, high_value_amount: float = HIGH_VALUE_AMOUNT) -> None:
        self._profiles: Dict[str, AccountProfile] = {}
        self.high_value_amount = high_value_amount

    # -- reads ---------------------------------------------------------------

    def profile(self, account_id: str) -> AccountProfile:
        return self._profiles.setdefault(account_id, AccountProfile(account_id=account_id))

    def all_profiles(self) -> List[AccountProfile]:
        return list(self._profiles.values())

    def high_risk_accounts(self, minimum_level: str = "high", limit: int = 50) -> List[AccountProfile]:
        order = {band.level: index for index, band in enumerate(ACCOUNT_RISK_BANDS)}
        cutoff = order.get(minimum_level, 2)
        selected = [
            profile
            for profile in self._profiles.values()
            if order.get(profile.risk_level, 0) >= cutoff
        ]
        selected.sort(key=lambda item: (item.risk_score, item.suspicious_count), reverse=True)
        return selected[:limit]

    def count_by_level(self) -> Dict[str, int]:
        counts = {band.level: 0 for band in ACCOUNT_RISK_BANDS}
        for profile in self._profiles.values():
            counts[profile.risk_level] = counts.get(profile.risk_level, 0) + 1
        return counts

    def reset(self) -> None:
        self._profiles.clear()

    # -- writes --------------------------------------------------------------

    def behavioural_features(
        self,
        account_id: str,
        amount: float,
        event_time: float,
    ) -> BehaviouralFeatures:
        """Context for the incoming transaction, based on prior activity only."""
        profile = self.profile(account_id)
        deviation = 0.0
        standard_deviation = profile.amount_standard_deviation
        if profile.transaction_count and standard_deviation > 1e-9:
            deviation = (amount - profile._amount_mean) / standard_deviation
        elif profile.transaction_count and profile._amount_mean > 1e-9:
            deviation = (amount - profile._amount_mean) / profile._amount_mean

        seconds_since_previous = (
            event_time - profile.last_event_time if profile.last_event_time is not None else None
        )
        window_start = event_time - VELOCITY_WINDOW_SECONDS
        velocity = sum(1 for stamp in profile._event_times if stamp >= window_start)

        return BehaviouralFeatures(
            account_transaction_count=profile.transaction_count,
            account_average_amount=profile._amount_mean,
            amount_deviation=deviation,
            seconds_since_previous=seconds_since_previous,
            transaction_velocity_1h=velocity,
            distinct_locations_recent=len(set(profile._locations)),
            is_high_value=amount >= self.high_value_amount,
        )

    def update(
        self,
        account_id: str,
        amount: float,
        event_time: float,
        risk_score: float,
        suspicious: bool,
        location: str = "",
        merchant_category: str = "",
        observed_at: Optional[str] = None,
    ) -> AccountProfile:
        """Fold one scored transaction into the account profile."""
        profile = self.profile(account_id)

        profile.transaction_count += 1
        profile.risk_sum += risk_score
        profile.maximum_risk_score = max(profile.maximum_risk_score, risk_score)
        if suspicious:
            profile.suspicious_count += 1
            if merchant_category:
                profile._suspicious_categories[merchant_category] += 1
        if amount >= self.high_value_amount:
            profile.high_value_count += 1

        # Welford running mean / variance for amount deviation.
        delta = amount - profile._amount_mean
        profile._amount_mean += delta / profile.transaction_count
        profile._amount_m2 += delta * (amount - profile._amount_mean)

        profile._event_times.append(event_time)
        if location:
            profile._locations.append(location)
        profile.last_event_time = event_time
        if observed_at:
            profile.last_activity = observed_at

        profile.risk_score = self._score_account(profile, event_time)
        profile.risk_level = classify_risk(profile.risk_score, ACCOUNT_RISK_BANDS).level
        return profile

    # -- scoring -------------------------------------------------------------

    def _score_account(self, profile: AccountProfile, event_time: float) -> float:
        count = max(profile.transaction_count, 1)

        window_start = event_time - VELOCITY_WINDOW_SECONDS
        velocity = sum(1 for stamp in profile._event_times if stamp >= window_start)

        signals = {
            "average_risk": _clamp(profile.average_risk_score, 0.0, 1.0),
            "maximum_risk": _clamp(profile.maximum_risk_score, 0.0, 1.0),
            "suspicious_ratio": _clamp(profile.suspicious_count / count, 0.0, 1.0),
            # 6 or more transactions inside the window saturates the signal.
            "velocity": _clamp((velocity - 1) / 5.0, 0.0, 1.0),
            "high_value_ratio": _clamp(profile.high_value_count / count, 0.0, 1.0),
            # 3 or more distinct recent locations saturates the signal.
            "geo_anomaly": _clamp((len(set(profile._locations)) - 1) / 2.0, 0.0, 1.0),
            "merchant_anomaly": _clamp(
                (max(profile._suspicious_categories.values()) if profile._suspicious_categories else 0)
                / 3.0,
                0.0,
                1.0,
            ),
        }

        score = sum(ACCOUNT_RISK_WEIGHTS[name] * value for name, value in signals.items())

        # A single confirmed critical transaction should not be diluted away by a
        # long clean history, so the account never scores below its worst hit
        # once it has produced a suspicious transaction.
        if profile.suspicious_count:
            score = max(score, 0.70)
        return round(_clamp(score, 0.0, 1.0), 6)

    def signal_breakdown(self, account_id: str) -> Dict[str, float]:
        """Expose the weighted signals behind an account score (for the UI)."""
        profile = self.profile(account_id)
        event_time = profile.last_event_time or 0.0
        count = max(profile.transaction_count, 1)
        window_start = event_time - VELOCITY_WINDOW_SECONDS
        velocity = sum(1 for stamp in profile._event_times if stamp >= window_start)
        return {
            "average_risk": round(_clamp(profile.average_risk_score, 0.0, 1.0), 4),
            "maximum_risk": round(_clamp(profile.maximum_risk_score, 0.0, 1.0), 4),
            "suspicious_ratio": round(_clamp(profile.suspicious_count / count, 0.0, 1.0), 4),
            "velocity": round(_clamp((velocity - 1) / 5.0, 0.0, 1.0), 4),
            "high_value_ratio": round(_clamp(profile.high_value_count / count, 0.0, 1.0), 4),
            "geo_anomaly": round(_clamp((len(set(profile._locations)) - 1) / 2.0, 0.0, 1.0), 4),
            "merchant_anomaly": round(
                _clamp(
                    (
                        max(profile._suspicious_categories.values())
                        if profile._suspicious_categories
                        else 0
                    )
                    / 3.0,
                    0.0,
                    1.0,
                ),
                4,
            ),
        }


def behaviour_reason_codes(
    assessment: RiskAssessment, features: BehaviouralFeatures
) -> List[Dict[str, object]]:
    """Return every human-readable reason that supports an investigation.

    Unlike ``alert_type_for``, which preserves one legacy primary label, this
    captures all matching evidence so analysts can understand the decision.
    """
    reasons: List[Dict[str, object]] = []
    if assessment.risk_level == "critical":
        reasons.append(
            {
                "code": "critical_model_risk",
                "label": "Critical model risk",
                "category": "model",
                "observed": assessment.risk_score,
                "threshold": 0.90,
                "detail": "The mapped fraud risk is inside the critical investigation band.",
            }
        )
    else:
        reasons.append(
            {
                "code": "high_model_risk",
                "label": "High model risk",
                "category": "model",
                "observed": assessment.risk_score,
                "threshold": ALERT_RISK_SCORE,
                "detail": "The fraud score crossed the tuned alert threshold.",
            }
        )
    if features.transaction_velocity_1h >= 6:
        reasons.append(
            {
                "code": "transaction_velocity",
                "label": "Rapid transaction velocity",
                "category": "behavior",
                "observed": features.transaction_velocity_1h,
                "threshold": 6,
                "detail": "At least six prior transactions occurred in the rolling hour.",
            }
        )
    if features.is_high_value:
        reasons.append(
            {
                "code": "high_value_amount",
                "label": "High-value transaction",
                "category": "behavior",
                "observed": True,
                "threshold": HIGH_VALUE_AMOUNT,
                "detail": f"The amount is at least {HIGH_VALUE_AMOUNT:.0f}.",
            }
        )
    if features.amount_deviation >= 3.0:
        reasons.append(
            {
                "code": "amount_deviation",
                "label": "Amount deviates from account history",
                "category": "behavior",
                "observed": round(features.amount_deviation, 3),
                "threshold": 3.0,
                "detail": "The amount is at least three deviations above prior account behavior.",
            }
        )
    if features.distinct_locations_recent >= 3:
        reasons.append(
            {
                "code": "geographical_anomaly",
                "label": "Multiple recent locations",
                "category": "behavior",
                "observed": features.distinct_locations_recent,
                "threshold": 3,
                "detail": "The account has appeared in at least three recent locations.",
            }
        )
    if features.account_transaction_count >= 3:
        reasons.append(
            {
                "code": "repeat_account_activity",
                "label": "Established account pattern",
                "category": "account",
                "observed": features.account_transaction_count,
                "threshold": 3,
                "detail": "Prior account activity is available for behavioral comparison.",
            }
        )
    return reasons


def alert_type_for(assessment: RiskAssessment, features: BehaviouralFeatures) -> str:
    """Pick a human readable alert label (FR-010)."""
    if assessment.risk_level == "critical":
        return "critical_fraud_probability"
    if features.transaction_velocity_1h >= 6:
        return "transaction_velocity"
    if features.is_high_value:
        return "high_value_anomaly"
    if features.amount_deviation >= 3.0:
        return "amount_deviation"
    if features.distinct_locations_recent >= 3:
        return "geographical_anomaly"
    return "high_fraud_probability"


def _clamp(value: float, lower: float, upper: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return lower
    if math.isnan(numeric):
        return lower
    return max(lower, min(upper, numeric))
