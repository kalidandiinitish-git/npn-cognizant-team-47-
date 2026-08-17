"""The pseudo-streaming transaction generator.

This is the core of PRD FR-008: the test dataset is turned into an event-like
stream where exactly one transaction is produced at a time. The implementation
uses :mod:`csv` rather than pandas on purpose - a DataFrame would materialise the
whole test set in memory, which is precisely the batch behaviour the PRD forbids.

Responsibilities (PRD pseudo_streaming.generator_responsibilities):
  * read transaction records sequentially
  * yield one transaction at a time
  * attach a transaction identifier
  * preserve the event timestamp
  * hand the transaction to the prediction pipeline (done by the consumer)
"""

from __future__ import annotations

import csv
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Dict, Iterator, Mapping, Optional, Tuple

from ..config import PCA_FEATURES, RAW_REQUIRED_COLUMNS, TARGET_COLUMN
from ..features.identity import derive_identity

logger = logging.getLogger(__name__)

#: The dataset stores ``Time`` as seconds elapsed since the first transaction.
#: Events are projected onto a readable wall-clock window for the dashboard.
STREAM_EPOCH = datetime(2025, 1, 6, 0, 0, 0, tzinfo=timezone.utc)


@dataclass
class TransactionEvent:
    """One streamed transaction."""

    transaction_id: str
    sequence: int
    event_time: float
    transaction_time: str
    amount: float
    features: Dict[str, float]
    identity: Dict[str, object]
    ingested_at: str
    label: Optional[int] = None
    #: 1-based line of the source CSV this event came from. Stable across runs,
    #: unlike ``transaction_id``, so replays of the same file stay traceable.
    source_row: int = 0
    #: Identifier of the stream run that emitted this event, when one was given.
    run_id: Optional[str] = None

    def model_record(self) -> Dict[str, float]:
        """The payload handed to the model (never includes the label)."""
        return self.features

    def as_dict(self) -> Dict[str, object]:
        payload: Dict[str, object] = {
            "transaction_id": self.transaction_id,
            "sequence": self.sequence,
            "source_row": self.source_row,
            "run_id": self.run_id,
            "event_time": self.event_time,
            "transaction_time": self.transaction_time,
            "amount": self.amount,
            "ingested_at": self.ingested_at,
        }
        payload.update(self.identity)
        return payload


class InvalidTransactionError(ValueError):
    """Raised for a record that cannot be scored (PRD PR-004)."""


def validate_record(row: Mapping[str, object]) -> Tuple[Dict[str, float], float, float]:
    """Validate one raw CSV row and return (features, event_time, amount).

    Raises :class:`InvalidTransactionError` with a readable reason so the caller
    can count the failure and keep the stream alive.
    """
    if "Time" not in row or "Amount" not in row:
        raise InvalidTransactionError("missing required Time or Amount column")

    try:
        event_time = float(row["Time"])  # type: ignore[arg-type]
        amount = float(row["Amount"])  # type: ignore[arg-type]
    except (TypeError, ValueError) as error:
        raise InvalidTransactionError(f"non numeric Time/Amount: {error}") from error

    if event_time < 0:
        raise InvalidTransactionError("negative event time")
    if amount < 0:
        raise InvalidTransactionError("negative amount")

    features: Dict[str, float] = {"Time": event_time, "Amount": amount}
    for name in PCA_FEATURES:
        raw = row.get(name)
        if raw is None or raw == "":
            raise InvalidTransactionError(f"missing feature {name}")
        try:
            features[name] = float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError) as error:
            raise InvalidTransactionError(f"non numeric {name}: {error}") from error
    return features, event_time, amount


def _event_timestamp(event_time: float) -> str:
    return (STREAM_EPOCH + timedelta(seconds=float(event_time))).isoformat()


def transaction_stream(
    source: Path,
    *,
    limit: Optional[int] = None,
    delay_ms: int = 0,
    skip: int = 0,
    should_continue: Optional[Callable[[], bool]] = None,
    on_invalid: Optional[Callable[[int, str], None]] = None,
    run_id: Optional[str] = None,
) -> Iterator[TransactionEvent]:
    """Yield transactions one at a time from ``source``.

    Args:
        source: CSV file holding the (held out) transactions to stream.
        limit: stop after this many valid transactions.
        delay_ms: pause between events, used to make the demo watchable.
        skip: number of leading rows to ignore.
        should_continue: polled before every event; return ``False`` to stop the
            stream cleanly mid-file.
        on_invalid: called with (row_number, reason) for each rejected record.
        run_id: mixed into every transaction id so ids stay unique across runs
            and across source files. Row position alone is not unique: replaying
            the same file, or streaming a different one, restarts the count at 1
            and collides with rows already written to ``transactions``, whose
            ``transaction_ref`` column is UNIQUE. Left out, ids keep the plain
            row-numbered form, which keeps direct library use deterministic.

    Yields:
        :class:`TransactionEvent` - exactly one per iteration.
    """
    source = Path(source)
    if not source.exists():
        raise FileNotFoundError(f"Stream source not found: {source}")

    emitted = 0
    delay_seconds = max(delay_ms, 0) / 1000.0

    with source.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row_number, row in enumerate(reader, start=1):
            if should_continue is not None and not should_continue():
                logger.info("Stream stopped by request after %s events", emitted)
                return
            if row_number <= skip:
                continue
            if limit is not None and emitted >= limit:
                return

            try:
                features, event_time, amount = validate_record(row)
            except InvalidTransactionError as error:
                logger.warning("Skipping invalid record at row %s: %s", row_number, error)
                if on_invalid is not None:
                    on_invalid(row_number, str(error))
                continue

            label: Optional[int] = None
            raw_label = row.get(TARGET_COLUMN)
            if raw_label not in (None, ""):
                try:
                    label = int(float(raw_label))  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    label = None

            emitted += 1
            event = TransactionEvent(
                transaction_id=(
                    f"TXN-{run_id}-{row_number:07d}" if run_id else f"TXN-{row_number:07d}"
                ),
                sequence=emitted,
                event_time=event_time,
                transaction_time=_event_timestamp(event_time),
                amount=amount,
                features=features,
                identity=derive_identity(features),
                ingested_at=datetime.now(timezone.utc).isoformat(),
                label=label,
                source_row=row_number,
                run_id=run_id,
            )

            if delay_seconds:
                time.sleep(delay_seconds)

            yield event


def count_transactions(source: Path) -> int:
    """Count data rows in a CSV without loading it into memory."""
    source = Path(source)
    if not source.exists():
        return 0
    with source.open("r", newline="", encoding="utf-8") as handle:
        return max(sum(1 for _ in handle) - 1, 0)


#: How many rows :func:`inspect_source` reads before deciding. Large enough that
#: a file whose first rows happen to be malformed is still judged on its body,
#: small enough that inspecting a 150 MB upload stays instant.
INSPECTION_SAMPLE_ROWS = 200


@dataclass(frozen=True)
class SourceInspection:
    """What a candidate stream file actually contains.

    The generator skips a record it cannot parse and keeps going, which is right
    for one bad row in a good file and wrong for a file that is the wrong shape
    entirely: every row is skipped, the run finishes "completed" with nothing
    processed, and no layer above ever learns why. This is the check that lets
    the caller answer that question before a stream is started.
    """

    path: Path
    exists: bool
    columns: Tuple[str, ...]
    missing_columns: Tuple[str, ...]
    sampled_rows: int
    valid_rows: int
    first_rejection: Optional[str]
    has_labels: bool

    @property
    def streamable(self) -> bool:
        return self.valid_rows > 0

    def rejection_reason(self) -> Optional[str]:
        """A message that names the actual problem, or None when streamable."""
        if self.streamable:
            return None
        name = self.path.name
        if not self.exists:
            return f"Stream source not found: {name}"
        if self.missing_columns:
            shown = ", ".join(self.missing_columns[:6])
            if len(self.missing_columns) > 6:
                shown += f" and {len(self.missing_columns) - 6} more"
            return (
                f"{name} is missing {len(self.missing_columns)} required "
                f"column(s): {shown}. The engine scores the ULB credit-card "
                f"schema: Time, V1-V28, Amount, and an optional Class label."
            )
        if self.sampled_rows == 0:
            return f"{name} has the right columns but no data rows."
        return (
            f"{name} has the right columns but none of its first "
            f"{self.sampled_rows} rows could be read: {self.first_rejection}."
        )


def inspect_source(source: Path, sample: int = INSPECTION_SAMPLE_ROWS) -> SourceInspection:
    """Read the header and up to ``sample`` rows to judge whether it can stream.

    Deliberately bounded: this runs on upload and on every stream start, and
    reading the whole file would reintroduce exactly the batch behaviour the
    generator exists to avoid.
    """
    source = Path(source)
    if not source.exists():
        return SourceInspection(
            path=source,
            exists=False,
            columns=(),
            missing_columns=tuple(RAW_REQUIRED_COLUMNS),
            sampled_rows=0,
            valid_rows=0,
            first_rejection=None,
            has_labels=False,
        )

    with source.open("r", newline="", encoding="utf-8", errors="replace") as handle:
        reader = csv.DictReader(handle)
        columns = tuple(reader.fieldnames or ())
        present = {name.strip() for name in columns}
        missing = tuple(
            name for name in RAW_REQUIRED_COLUMNS if name not in present
        )

        sampled = 0
        valid = 0
        first_rejection: Optional[str] = None
        # A file missing required columns cannot produce a single valid row, so
        # there is nothing to learn from reading it.
        if not missing:
            for row in reader:
                if sampled >= sample:
                    break
                sampled += 1
                try:
                    validate_record(row)
                except InvalidTransactionError as error:
                    if first_rejection is None:
                        first_rejection = str(error)
                    continue
                valid += 1

    return SourceInspection(
        path=source,
        exists=True,
        columns=columns,
        missing_columns=missing,
        sampled_rows=sampled,
        valid_rows=valid,
        first_rejection=first_rejection,
        has_labels=TARGET_COLUMN in present,
    )
