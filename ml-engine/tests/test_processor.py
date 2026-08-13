"""Stream processing loop tests using a stub predictor."""

from __future__ import annotations

from pathlib import Path

from src.streaming.generator import transaction_stream
from src.streaming.processor import StreamProcessor
from src.streaming.state import StreamStatus


def build_processor(stub_predictor, stub_writer) -> StreamProcessor:
    return StreamProcessor(predictor=stub_predictor, writer=stub_writer)


def test_each_event_produces_exactly_one_scored_row(sample_csv: Path, stub_predictor, stub_writer):
    processor = build_processor(stub_predictor, stub_writer)

    events = list(transaction_stream(sample_csv, limit=10))
    for event in events:
        processor.process_event(event, persist=False)

    assert stub_predictor.calls == 10, "one prediction per transaction, no batching"
    assert processor.state.processed == 10
    assert len(processor.state.recent_transactions(limit=50)) == 10


def test_scored_row_has_every_dashboard_field(sample_csv: Path, stub_predictor, stub_writer):
    processor = build_processor(stub_predictor, stub_writer)
    event = next(transaction_stream(sample_csv))
    row = processor.process_event(event, persist=False)

    for field in (
        "transaction_ref",
        "account_id",
        "transaction_amount",
        "merchant",
        "merchant_category",
        "location",
        "transaction_time",
        "model_score",
        "risk_score",
        "risk_level",
        "decision",
        "is_fraud",
        "inference_latency_ms",
        "processing_latency_ms",
        "behaviour",
    ):
        assert field in row, field
    assert 0.0 <= row["risk_score"] <= 1.0
    assert row["inference_latency_ms"] >= 0


def test_high_amounts_raise_alerts_and_escalate_the_account(
    sample_csv: Path, stub_predictor, stub_writer
):
    """The stub scores amount/100, so amounts above 50 cross the 0.5 threshold."""
    processor = build_processor(stub_predictor, stub_writer)
    for event in transaction_stream(sample_csv, limit=40):
        processor.process_event(event, persist=False)

    alerts = processor.state.recent_alerts(limit=100)
    assert alerts, "expected alerts for the high value rows"
    for alert in alerts:
        assert alert["risk_level"] in {"high", "critical"}
        assert alert["status"] == "open"
        assert alert["transaction_id"].startswith("TXN-")

    assert processor.state.alerts_raised == len(alerts)
    assert processor.high_risk_accounts(minimum_level="high")


def test_labels_feed_the_live_confusion_matrix(sample_csv: Path, stub_predictor, stub_writer):
    processor = build_processor(stub_predictor, stub_writer)
    for event in transaction_stream(sample_csv, limit=40):
        processor.process_event(event, persist=False)

    quality = processor.state.live_quality()
    total = (
        quality["true_positives"]
        + quality["false_positives"]
        + quality["true_negatives"]
        + quality["false_negatives"]
    )
    assert total == processor.state.processed


def test_metrics_payload_shape(sample_csv: Path, stub_predictor, stub_writer):
    processor = build_processor(stub_predictor, stub_writer)
    for event in transaction_stream(sample_csv, limit=12):
        processor.process_event(event, persist=False)

    metrics = processor.metrics()
    assert set(metrics) >= {
        "stream",
        "totals",
        "latency",
        "risk_distribution",
        "account_risk_levels",
        "live_quality",
        "timeline",
        "persistence",
    }
    totals = metrics["totals"]
    assert totals["total_transactions"] == 12
    assert 0 <= totals["fraud_detection_rate"] <= 100
    assert {entry["level"] for entry in metrics["risk_distribution"]} == {
        "low",
        "medium",
        "high",
        "critical",
    }
    assert metrics["latency"]["sample_size"] == 12


def test_background_stream_start_and_stop(sample_csv: Path, stub_predictor, stub_writer):
    processor = build_processor(stub_predictor, stub_writer)
    started = processor.start(source=str(sample_csv), limit=10, delay_ms=0, persist=False)
    assert started["started"] is True

    if processor._thread is not None:
        processor._thread.join(timeout=15)

    assert processor.state.processed == 10
    assert processor.state.status in {StreamStatus.COMPLETED, StreamStatus.IDLE}
    assert processor.state.invalid_records >= 0

    # Starting again after completion is allowed and resets the counters.
    processor.start(source=str(sample_csv), limit=3, delay_ms=0, persist=False)
    stopped = processor.stop()
    assert stopped["stopped"] is True
    assert processor.is_running is False


def test_counters_reset_between_runs(sample_csv: Path, stub_predictor, stub_writer):
    processor = build_processor(stub_predictor, stub_writer)
    for event in transaction_stream(sample_csv, limit=5):
        processor.process_event(event, persist=False)
    assert processor.state.processed == 5

    processor.state.reset_counters()
    processor.accounts.reset()
    assert processor.state.processed == 0
    assert processor.state.recent_transactions() == []
    assert processor.accounts.all_profiles() == []
