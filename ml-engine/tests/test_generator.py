"""Streaming tests from PRD testing_strategy.streaming_tests."""

from __future__ import annotations

import csv
import inspect
from pathlib import Path

import pytest

from src.config import PCA_FEATURES
from src.streaming import generator as generator_module
from src.streaming.generator import (
    InvalidTransactionError,
    TransactionEvent,
    count_transactions,
    inspect_source,
    transaction_stream,
    validate_record,
)
from tests.conftest import make_row


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


def test_run_id_makes_ids_unique_across_runs_and_files(sample_csv: Path, tmp_path: Path):
    """Row position alone repeats; the run id is what keeps ids unique."""
    plain_a = [event.transaction_id for event in transaction_stream(sample_csv, limit=3)]
    plain_b = [event.transaction_id for event in transaction_stream(sample_csv, limit=3)]
    assert plain_a == plain_b, "without a run id, ids are purely positional"

    tagged_a = [
        event.transaction_id for event in transaction_stream(sample_csv, limit=3, run_id="AAA111")
    ]
    tagged_b = [
        event.transaction_id for event in transaction_stream(sample_csv, limit=3, run_id="BBB222")
    ]
    assert not set(tagged_a) & set(tagged_b)
    assert all(ref.startswith("TXN-AAA111-") for ref in tagged_a)

    # A different file restarts row numbering, so it must not collide either.
    other = tmp_path / "other.csv"
    other.write_text(sample_csv.read_text(encoding="utf-8"), encoding="utf-8")
    tagged_other = [
        event.transaction_id for event in transaction_stream(other, limit=3, run_id="CCC333")
    ]
    assert not set(tagged_other) & (set(tagged_a) | set(tagged_b))


def test_events_record_their_source_row(sample_csv: Path):
    """source_row is the CSV line, so it survives the id changing per run."""
    events = list(transaction_stream(sample_csv, limit=4, run_id="RUN001"))
    assert [event.source_row for event in events] == [1, 2, 3, 4]
    assert all(event.run_id == "RUN001" for event in events)
    # Row 5 is malformed, so sequence and source row diverge past it.
    later = list(transaction_stream(sample_csv, limit=6, run_id="RUN001"))[-1]
    assert later.sequence == 6 and later.source_row == 7


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


# ---------------------------------------------------------------------------
# Source inspection
#
# A CSV that is not in the ULB schema used to upload happily, report a row
# count, and then stream to zero transactions with no error anywhere: the
# generator rejected every row, the run finished "completed", and the dashboard
# simply showed nothing. These tests pin the check that turns that silent no-op
# into an answer.
# ---------------------------------------------------------------------------


def test_inspect_accepts_a_well_formed_source(sample_csv: Path):
    inspection = inspect_source(sample_csv)
    assert inspection.streamable
    assert inspection.missing_columns == ()
    assert inspection.has_labels, "Class is present, so the fixture is labelled"
    assert inspection.valid_rows > 0
    assert inspection.rejection_reason() is None


def test_inspect_rejects_a_foreign_schema(tmp_path: Path):
    """The exact file shape a demo visitor brings: a bank-export CSV."""
    path = tmp_path / "bank_export.csv"
    path.write_text(
        "date,amount,merchant,card_last4\n"
        "2026-08-17T10:00:00,120.55,Amazon,4412\n",
        encoding="utf-8",
    )
    inspection = inspect_source(path)
    assert not inspection.streamable
    assert "V1" in inspection.missing_columns
    reason = inspection.rejection_reason()
    # The message has to name what is wrong, not just that something is.
    assert "V1" in reason and "bank_export.csv" in reason


def test_inspect_reports_a_header_only_file(tmp_path: Path):
    path = tmp_path / "empty.csv"
    fieldnames = ["Time"] + list(PCA_FEATURES) + ["Amount"]
    path.write_text(",".join(fieldnames) + "\n", encoding="utf-8")
    inspection = inspect_source(path)
    assert not inspection.streamable
    assert inspection.missing_columns == (), "the header itself is fine"
    assert "no data rows" in inspection.rejection_reason()


def test_inspect_accepts_an_unlabelled_source(tmp_path: Path):
    """Class is optional: without it the model still scores, it just cannot be graded."""
    path = tmp_path / "unlabelled.csv"
    fieldnames = ["Time"] + list(PCA_FEATURES) + ["Amount"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for index in range(1, 4):
            row = make_row(index)
            row.pop("Class")
            writer.writerow(row)
    inspection = inspect_source(path)
    assert inspection.streamable
    assert not inspection.has_labels


def test_inspect_names_the_bad_value_when_columns_are_right(tmp_path: Path):
    """Right header, unparseable values - the reason must say which."""
    path = tmp_path / "corrupt.csv"
    fieldnames = ["Time"] + list(PCA_FEATURES) + ["Amount"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        row = make_row(1)
        row.pop("Class")
        row["V7"] = "not-a-number"
        writer.writerow(row)
    inspection = inspect_source(path)
    assert not inspection.streamable
    assert "V7" in inspection.rejection_reason()


def test_inspect_reads_only_the_sample(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Inspection must not become a batch read of a 150 MB upload."""
    path = tmp_path / "big.csv"
    fieldnames = ["Time"] + list(PCA_FEATURES) + ["Amount", "Class"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for index in range(1, 501):
            writer.writerow(make_row(index))

    calls = {"count": 0}
    original = generator_module.validate_record

    def counting_validate(row):
        calls["count"] += 1
        return original(row)

    monkeypatch.setattr(generator_module, "validate_record", counting_validate)
    inspection = inspect_source(path, sample=25)
    assert inspection.streamable
    assert calls["count"] <= 25, "inspection sampled the file instead of reading it all"


def test_inspect_missing_file_is_not_streamable(tmp_path: Path):
    inspection = inspect_source(tmp_path / "nope.csv")
    assert not inspection.streamable
    assert "not found" in inspection.rejection_reason().lower()
