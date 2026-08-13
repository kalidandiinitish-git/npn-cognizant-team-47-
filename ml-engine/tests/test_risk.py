"""Risk engine tests (PRD FR-007, FR-010, FR-011)."""

from __future__ import annotations

import pytest

from src.config import ALERT_RISK_SCORE, RISK_BANDS
from src.risk.scoring import (
    AccountRiskEngine,
    alert_type_for,
    assess,
    classify_risk,
    probability_to_risk_score,
)


def test_threshold_maps_to_start_of_high_band():
    for threshold in (0.1, 0.2372, 0.5, 0.9964):
        assert probability_to_risk_score(threshold, threshold) == pytest.approx(0.70, abs=1e-6)


def test_risk_score_endpoints_and_monotonicity():
    threshold = 0.3
    assert probability_to_risk_score(0.0, threshold) == 0.0
    assert probability_to_risk_score(1.0, threshold) == pytest.approx(1.0)

    previous = -1.0
    for step in range(0, 101):
        score = probability_to_risk_score(step / 100.0, threshold)
        assert score >= previous, "risk score must never decrease as probability rises"
        previous = score


def test_bands_match_the_prd():
    expected = {
        "low": (0.00, 0.40, "Allow"),
        "medium": (0.40, 0.70, "Monitor"),
        "high": (0.70, 0.90, "Flag"),
        "critical": (0.90, 1.01, "Alert and investigate"),
    }
    assert {band.level for band in RISK_BANDS} == set(expected)
    for band in RISK_BANDS:
        lower, upper, action = expected[band.level]
        assert (band.lower, band.upper, band.action) == (lower, upper, action)


@pytest.mark.parametrize(
    "score,level",
    [
        (0.0, "low"),
        (0.39, "low"),
        (0.40, "medium"),
        (0.69, "medium"),
        (0.70, "high"),
        (0.89, "high"),
        (0.90, "critical"),
        (1.00, "critical"),
    ],
)
def test_classify_risk(score, level):
    assert classify_risk(score).level == level


def test_assess_flags_at_the_alert_threshold():
    below = assess(0.49, 0.5)
    assert below.risk_level in {"low", "medium"}
    assert below.alert_required is False
    assert below.is_fraud_prediction is False

    at = assess(0.5, 0.5)
    assert at.risk_score == pytest.approx(ALERT_RISK_SCORE)
    assert at.alert_required is True
    assert at.is_fraud_prediction is True
    assert at.action == "Flag"

    top = assess(0.999, 0.5)
    assert top.risk_level == "critical"
    assert top.action == "Alert and investigate"


def test_account_risk_aggregates_repeated_suspicion():
    engine = AccountRiskEngine()
    account = "ACC-00001"

    profile = engine.update(account, 20.0, 0.0, 0.10, False, "Berlin, DE", "Grocery")
    assert profile.risk_level == "low"
    assert profile.transaction_count == 1

    for index in range(1, 5):
        profile = engine.update(
            account, 900.0, index * 60.0, 0.95, True, "Lagos, NG", "Crypto Exchange"
        )

    assert profile.suspicious_count == 4
    assert profile.risk_level in {"high", "critical"}
    assert profile.maximum_risk_score == pytest.approx(0.95)
    assert 0.0 < profile.average_risk_score <= 1.0
    assert engine.high_risk_accounts()[0].account_id == account
    assert engine.count_by_level()["high"] + engine.count_by_level()["critical"] == 1


def test_behavioural_features_use_prior_activity_only():
    engine = AccountRiskEngine()
    account = "ACC-00002"

    first = engine.behavioural_features(account, 100.0, 0.0)
    assert first.account_transaction_count == 0
    assert first.seconds_since_previous is None
    assert first.transaction_velocity_1h == 0

    engine.update(account, 100.0, 0.0, 0.1, False, "Paris, FR", "Fuel")
    second = engine.behavioural_features(account, 4000.0, 120.0)
    assert second.account_transaction_count == 1
    assert second.seconds_since_previous == pytest.approx(120.0)
    assert second.transaction_velocity_1h == 1
    assert second.is_high_value is True
    assert second.amount_deviation > 0


def test_high_risk_filter_and_reset():
    engine = AccountRiskEngine()
    engine.update("ACC-A", 10.0, 0.0, 0.05, False)
    engine.update("ACC-B", 5000.0, 10.0, 0.98, True)

    assert [profile.account_id for profile in engine.high_risk_accounts()] == ["ACC-B"]
    assert len(engine.high_risk_accounts(minimum_level="low")) == 2

    engine.reset()
    assert engine.all_profiles() == []


def test_alert_type_selection():
    engine = AccountRiskEngine()
    features = engine.behavioural_features("ACC-C", 900.0, 0.0)

    critical = assess(0.999, 0.5)
    assert alert_type_for(critical, features) == "critical_fraud_probability"

    high = assess(0.6, 0.5)
    assert alert_type_for(high, features) == "high_value_anomaly"


def test_signal_breakdown_weights_are_normalised():
    from src.risk.scoring import ACCOUNT_RISK_WEIGHTS

    assert sum(ACCOUNT_RISK_WEIGHTS.values()) == pytest.approx(1.0)
