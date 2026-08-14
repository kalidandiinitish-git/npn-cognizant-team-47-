"""Stream processing loop tests using a stub predictor."""

from __future__ import annotations

from pathlib import Path

from src.streaming.generator import transaction_stream
from src.streaming.processor import TRANSACTION_COLUMNS, StreamProcessor
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


def test_transaction_refs_never_repeat_across_runs(
    sample_csv: Path, stub_predictor, stub_writer
):
    """transactions.transaction_ref is UNIQUE, so a replay must not reuse ids.

    Row position restarts at 1 on every run. Without a per-run discriminator the
    second run collides with rows already stored, and because inserts are
    batched one duplicate rejects its whole batch - persistence dies silently
    while the in-memory dashboard keeps looking healthy.
    """
    processor = build_processor(stub_predictor, stub_writer)

    def run_once() -> set:
        processor.start(source=str(sample_csv), limit=8, delay_ms=0, persist=False)
        if processor._thread is not None:
            processor._thread.join(timeout=15)
        return {row["transaction_ref"] for row in processor.state.recent_transactions(limit=50)}

    first = run_once()
    second = run_once()

    assert len(first) == 8 and len(second) == 8, "each run must emit 8 distinct refs"
    assert not (first & second), f"refs reused across runs: {sorted(first & second)}"


def test_source_row_stays_stable_while_refs_differ(
    sample_csv: Path, stub_predictor, stub_writer
):
    """The run id is what changes; the source row keeps replays traceable."""
    processor = build_processor(stub_predictor, stub_writer)

    def first_row() -> dict:
        processor.start(source=str(sample_csv), limit=3, delay_ms=0, persist=False)
        if processor._thread is not None:
            processor._thread.join(timeout=15)
        rows = processor.state.recent_transactions(limit=50)
        return sorted(rows, key=lambda item: item["sequence"])[0]

    one, two = first_row(), first_row()

    assert one["source_row"] == two["source_row"], "same CSV line, same source row"
    assert one["transaction_ref"] != two["transaction_ref"]
    assert one["run_id"] and one["run_id"] != two["run_id"]


def test_persisted_payload_only_carries_schema_columns(
    sample_csv: Path, stub_predictor, stub_writer
):
    """PostgREST rejects the whole insert on an unknown column, so the payload
    is projected onto the columns 0001_init.sql actually declares."""
    processor = build_processor(stub_predictor, stub_writer)
    event = next(transaction_stream(sample_csv, run_id="ABC123"))
    row = processor.process_event(event, persist=False)

    payload = processor._persistable_transaction(row)

    assert set(payload) <= set(TRANSACTION_COLUMNS)
    # Dashboard-only fields must be dropped rather than sent to Postgres.
    assert "source_row" in row and "source_row" not in payload
    assert "run_id" in row and "run_id" not in payload
    # ...while everything the table does declare still gets through.
    assert payload["transaction_ref"] == row["transaction_ref"]
    assert payload["behaviour"] == row["behaviour"]


def test_live_quality_reports_zero_precision_rather_than_nothing(stub_predictor, stub_writer):
    """A precision of 0.0 is a measured result, not an absent one."""
    processor = build_processor(stub_predictor, stub_writer)
    state = processor.state

    # One flagged transaction that was actually legitimate: precision is 0.0,
    # recall is undefined (no positives exist), so F1 cannot be computed.
    state.record_transaction(
        row={}, latency_ms=1.0, risk_level="critical", flagged=True, label=0
    )
    quality = state.live_quality()
    assert quality["precision"] == 0.0, "0.0 must survive, not collapse to None"
    assert quality["recall"] is None

    # Add a missed fraud: recall becomes 0.0 too, so F1 is a real 0.0.
    state.record_transaction(
        row={}, latency_ms=1.0, risk_level="low", flagged=False, label=1
    )
    quality = state.live_quality()
    assert quality["precision"] == 0.0
    assert quality["recall"] == 0.0
    assert quality["f1_score"] == 0.0, "F1 of a model getting everything wrong is 0, not unknown"


def test_live_quality_leaves_unmeasured_values_none(stub_predictor, stub_writer):
    """Nothing scored yet means genuinely unknown, which stays None."""
    processor = build_processor(stub_predictor, stub_writer)
    quality = processor.state.live_quality()
    assert quality["precision"] is None
    assert quality["recall"] is None
    assert quality["f1_score"] is None


class CountingWriter:
    """An enabled writer that reports cumulative totals, like the real one."""

    enabled = True

    def __init__(self) -> None:
        self.succeeded = 0
        self.failed = 0

    def write_transaction(self, _payload) -> None:
        self.succeeded += 1

    def write_alert(self, _payload) -> None:
        self.succeeded += 1

    def write_investigation_case(self, _payload) -> None:
        self.succeeded += 1

    def write_account_risk(self, _payload) -> None:
        self.failed += 1  # stand-in for a rejected row

    def stats(self):
        return {"enabled": True, "queued": 0, "succeeded": self.succeeded, "failed": self.failed}

    def flush(self, timeout: float = 0.0) -> None:
        return None

    def close(self, timeout: float = 0.0) -> None:
        return None


def test_persistence_counters_report_real_writer_activity(sample_csv: Path, stub_predictor):
    """The run-scoped counters were hard-wired to zero and never moved."""
    writer = CountingWriter()
    processor = StreamProcessor(predictor=stub_predictor, writer=writer)

    processor.start(source=str(sample_csv), limit=6, delay_ms=0, persist=True)
    if processor._thread is not None:
        processor._thread.join(timeout=15)

    status = processor.status()
    assert status["persisted"] == writer.succeeded > 0
    assert status["persist_failures"] == writer.failed

    # A second run reports only its own share, not the cumulative total.
    before = writer.succeeded
    processor.start(source=str(sample_csv), limit=3, delay_ms=0, persist=True)
    if processor._thread is not None:
        processor._thread.join(timeout=15)

    second = processor.status()
    assert second["persisted"] == writer.succeeded - before
    assert second["persisted"] < writer.succeeded, "counters must be per run, not cumulative"


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
