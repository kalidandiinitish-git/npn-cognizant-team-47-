"""Streaming tests from PRD testing_strategy.streaming_tests."""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from src.streaming import generator as generator_module
from src.streaming.generator import (
    InvalidTransactionError,
    TransactionEvent,
    count_transactions,
    transaction_stream,
    validate_record,
)


def test_transaction_stream_is_a_generator(sample_csv: Path):
    stream = transaction_stream(sample_csv)
    assert inspect.isgenerator(stream), "FR-008 requires a Python generator"
    stream.close()


def test_yields_one_transaction_at_a_time(sample_csv: Path):
    stream = transaction_stream(sample_csv)
    first = next(stream)
    second = next(stream)

    assert isinstance(first, TransactionEvent)
    assert isinstance(second, TransactionEvent)
    # A batch would arrive as a list/frame; a stream arrives as single events.
    assert not isinstance(first, (list, tuple, dict))
    assert second.sequence == first.sequence + 1
    stream.close()


def test_no_batch_read_happens(sample_csv: Path, monkeypatch: pytest.MonkeyPatch):
    """Only the consumed rows may be parsed - proves the read stays lazy."""
    calls = {"count": 0}
    original = generator_module.validate_record

    def counting_validate(row):
        calls["count"] += 1
        return original(row)

    monkeypatch.setattr(generator_module, "validate_record", counting_validate)

    stream = transaction_stream(sample_csv)
    next(stream)
    next(stream)
    next(stream)
    assert calls["count"] == 3, "the generator parsed more rows than were consumed"
    stream.close()


def test_every_transaction_carries_id_timestamp_and_identity(sample_csv: Path):
    for event in transaction_stream(sample_csv, limit=5):
        assert event.transaction_id.startswith("TXN-")
        assert event.transaction_time.endswith("+00:00")
        assert event.event_time >= 0
        assert event.identity["account_id"].startswith("ACC-")
        assert "Class" not in event.model_record(), "the label must never reach the model"


def test_invalid_records_are_skipped_and_reported(sample_csv: Path):
    rejected = []
    events = list(
        transaction_stream(
            sample_csv, on_invalid=lambda row, reason: rejected.append((row, reason))
        )
    )
    assert len(rejected) == 1, "the malformed row should be rejected exactly once"
    assert "V3" in rejected[0][1]
    # 40 data rows, one malformed.
    assert len(events) == 39
    assert count_transactions(sample_csv) == 40


def test_stream_stops_safely_mid_file(sample_csv: Path):
    stop = {"flag": False}
    consumed = []
    for event in transaction_stream(sample_csv, should_continue=lambda: not stop["flag"]):
        consumed.append(event)
        if len(consumed) == 4:
            stop["flag"] = True
    assert len(consumed) == 4, "stopping must not lose or duplicate events"


def test_limit_is_respected(sample_csv: Path):
    assert len(list(transaction_stream(sample_csv, limit=7))) == 7


def test_skip_offsets_the_stream(sample_csv: Path):
    without_skip = list(transaction_stream(sample_csv, limit=3))
    with_skip = list(transaction_stream(sample_csv, skip=2, limit=3))
    assert without_skip[0].transaction_id != with_skip[0].transaction_id


def test_validate_record_rejects_bad_input():
    with pytest.raises(InvalidTransactionError):
        validate_record({"Amount": "10"})  # no Time
    with pytest.raises(InvalidTransactionError):
        validate_record({"Time": "0", "Amount": "-5"})
    with pytest.raises(InvalidTransactionError):
        validate_record({"Time": "abc", "Amount": "1"})


def test_missing_source_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        list(transaction_stream(tmp_path / "nope.csv"))
