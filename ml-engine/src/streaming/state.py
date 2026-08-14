"""In-memory stream state, counters and latency statistics.

Supabase is the durable store, but the API also keeps a rolling window in memory
so the dashboard still works when Supabase is not configured, and so
``/api/metrics`` never has to run an aggregate query on the hot path.
"""

from __future__ import annotations

import statistics
import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Deque, Dict, List, Optional

from ..config import LATENCY_TARGET_MS, RISK_BANDS, settings

LATENCY_WINDOW = 5_000
TIMELINE_BUCKETS = 120


class StreamStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    STOPPING = "stopping"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class StreamConfig:
    """Parameters a stream run was started with."""

    source: str = ""
    limit: Optional[int] = None
    delay_ms: int = 0
    skip: int = 0
    persist: bool = True
    #: Short identifier for this run, mixed into every transaction id so ids
    #: stay unique across restarts and across source files.
    run_id: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "limit": self.limit,
            "delay_ms": self.delay_ms,
            "skip": self.skip,
            "persist": self.persist,
            "run_id": self.run_id,
        }


class StreamState:
    """Thread-safe counters and buffers for the running pseudo-stream."""

    def __init__(self, buffer_size: int = None) -> None:
        size = buffer_size or settings.buffer_size
        self._lock = threading.RLock()

        self.status: StreamStatus = StreamStatus.IDLE
        self.config = StreamConfig()
        self.error: Optional[str] = None
        self.started_at: Optional[float] = None
        self.finished_at: Optional[float] = None

        self.processed = 0
        self.invalid_records = 0
        self.persisted = 0
        self.persist_failures = 0
        self.alerts_raised = 0

        self.risk_levels: Counter = Counter()
        self.true_positives = 0
        self.false_positives = 0
        self.true_negatives = 0
        self.false_negatives = 0
        self.labelled_records = 0

        self._latencies: Deque[float] = deque(maxlen=LATENCY_WINDOW)
        self._transactions: Deque[Dict[str, Any]] = deque(maxlen=size)
        self._alerts: Deque[Dict[str, Any]] = deque(maxlen=size)
        self._timeline: Deque[Dict[str, Any]] = deque(maxlen=TIMELINE_BUCKETS)

    # -- lifecycle -----------------------------------------------------------

    def begin(self, config: StreamConfig) -> None:
        with self._lock:
            self.status = StreamStatus.RUNNING
            self.config = config
            self.error = None
            self.started_at = time.time()
            self.finished_at = None

    def request_stop(self) -> None:
        with self._lock:
            if self.status == StreamStatus.RUNNING:
                self.status = StreamStatus.STOPPING

    def finish(self, status: StreamStatus, error: Optional[str] = None) -> None:
        with self._lock:
            self.status = status
            self.error = error
            self.finished_at = time.time()

    def reset_counters(self) -> None:
        with self._lock:
            self.processed = 0
            self.invalid_records = 0
            self.persisted = 0
            self.persist_failures = 0
            self.alerts_raised = 0
            self.risk_levels.clear()
            self.true_positives = 0
            self.false_positives = 0
            self.true_negatives = 0
            self.false_negatives = 0
            self.labelled_records = 0
            self._latencies.clear()
            self._transactions.clear()
            self._alerts.clear()
            self._timeline.clear()

    # -- recording -----------------------------------------------------------

    def record_invalid(self) -> None:
        with self._lock:
            self.invalid_records += 1

    def set_persistence(self, succeeded: int, failed: int = 0) -> None:
        """Publish how much of *this run* reached Supabase.

        Absolute rather than incremental: the writer already keeps cumulative
        totals across runs, and the processor reports the delta since the run
        began, so counting here as well would double count.
        """
        with self._lock:
            self.persisted = max(int(succeeded), 0)
            self.persist_failures = max(int(failed), 0)

    def record_transaction(
        self,
        row: Dict[str, Any],
        latency_ms: float,
        risk_level: str,
        flagged: bool,
        label: Optional[int],
        alert: Optional[Dict[str, Any]] = None,
    ) -> None:
        with self._lock:
            self.processed += 1
            self.risk_levels[risk_level] += 1
            self._latencies.append(latency_ms)
            self._transactions.appendleft(row)

            if alert is not None:
                self.alerts_raised += 1
                self._alerts.appendleft(alert)

            if label is not None:
                self.labelled_records += 1
                if label == 1 and flagged:
                    self.true_positives += 1
                elif label == 1 and not flagged:
                    self.false_negatives += 1
                elif label == 0 and flagged:
                    self.false_positives += 1
                else:
                    self.true_negatives += 1

            self._append_timeline(latency_ms, flagged)

    def _append_timeline(self, latency_ms: float, flagged: bool) -> None:
        second = int(time.time())
        if self._timeline and self._timeline[-1]["second"] == second:
            bucket = self._timeline[-1]
            bucket["transactions"] += 1
            bucket["flagged"] += 1 if flagged else 0
            bucket["latency_sum"] += latency_ms
        else:
            self._timeline.append(
                {
                    "second": second,
                    "transactions": 1,
                    "flagged": 1 if flagged else 0,
                    "latency_sum": latency_ms,
                }
            )

    # -- reads ---------------------------------------------------------------

    def latency_stats(self) -> Dict[str, Optional[float]]:
        with self._lock:
            samples = list(self._latencies)
        if not samples:
            return {
                "average_ms": None,
                "median_ms": None,
                "p95_ms": None,
                "p99_ms": None,
                "max_ms": None,
                "target_ms": LATENCY_TARGET_MS,
                "within_target": None,
                "sample_size": 0,
            }
        ordered = sorted(samples)
        average = statistics.fmean(ordered)
        return {
            "average_ms": round(average, 3),
            "median_ms": round(_percentile(ordered, 50), 3),
            "p95_ms": round(_percentile(ordered, 95), 3),
            "p99_ms": round(_percentile(ordered, 99), 3),
            "max_ms": round(ordered[-1], 3),
            "target_ms": LATENCY_TARGET_MS,
            "within_target": bool(_percentile(ordered, 95) < LATENCY_TARGET_MS),
            "sample_size": len(ordered),
        }

    def elapsed_seconds(self) -> float:
        with self._lock:
            if self.started_at is None:
                return 0.0
            end = self.finished_at or time.time()
            return max(end - self.started_at, 0.0)

    def throughput(self) -> float:
        elapsed = self.elapsed_seconds()
        with self._lock:
            processed = self.processed
        if elapsed <= 0:
            return 0.0
        return round(processed / elapsed, 2)

    def live_quality(self) -> Dict[str, Optional[float]]:
        """Precision / recall measured on the labels seen so far in the stream."""
        with self._lock:
            tp, fp, tn, fn = (
                self.true_positives,
                self.false_positives,
                self.true_negatives,
                self.false_negatives,
            )
        precision = tp / (tp + fp) if (tp + fp) else None
        recall = tp / (tp + fn) if (tp + fn) else None
        # Guard on None, not truthiness: a precision of exactly 0.0 is a
        # measured result (every flag was wrong), and reporting it as "not
        # measured yet" hides the worst case the dashboard exists to show.
        if precision is None or recall is None:
            f1 = None
        elif precision + recall == 0:
            f1 = 0.0
        else:
            f1 = 2 * precision * recall / (precision + recall)
        return {
            "true_positives": tp,
            "false_positives": fp,
            "true_negatives": tn,
            "false_negatives": fn,
            "precision": round(precision, 4) if precision is not None else None,
            "recall": round(recall, 4) if recall is not None else None,
            "f1_score": round(f1, 4) if f1 is not None else None,
            "false_positive_rate": round(fp / (fp + tn), 6) if (fp + tn) else None,
        }

    def risk_distribution(self) -> List[Dict[str, Any]]:
        with self._lock:
            total = max(self.processed, 1)
            counts = dict(self.risk_levels)
        return [
            {
                "level": band.level,
                "action": band.action,
                "count": counts.get(band.level, 0),
                "percentage": round(100.0 * counts.get(band.level, 0) / total, 2),
            }
            for band in RISK_BANDS
        ]

    def timeline(self) -> List[Dict[str, Any]]:
        with self._lock:
            buckets = list(self._timeline)
        return [
            {
                "timestamp": datetime.fromtimestamp(
                    bucket["second"], tz=timezone.utc
                ).isoformat(),
                "transactions": bucket["transactions"],
                "flagged": bucket["flagged"],
                "average_latency_ms": round(
                    bucket["latency_sum"] / max(bucket["transactions"], 1), 3
                ),
            }
            for bucket in buckets
        ]

    def recent_transactions(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._transactions)[: max(limit, 0)]

    def recent_alerts(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._alerts)[: max(limit, 0)]

    def update_alert_status(
        self, status: str, transaction_id: Optional[str] = None, alert_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Atomically update one buffered alert and return a detached snapshot."""
        with self._lock:
            for alert in self._alerts:
                matches_id = alert_id is not None and alert.get("id") == alert_id
                matches_transaction = (
                    transaction_id is not None
                    and alert.get("transaction_id") == transaction_id
                )
                if matches_id or matches_transaction:
                    alert["status"] = status
                    return dict(alert)
        return None

    def status_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "status": self.status.value,
                "config": self.config.as_dict(),
                "processed": self.processed,
                "invalid_records": self.invalid_records,
                "alerts_raised": self.alerts_raised,
                "persisted": self.persisted,
                "persist_failures": self.persist_failures,
                "started_at": (
                    datetime.fromtimestamp(self.started_at, tz=timezone.utc).isoformat()
                    if self.started_at
                    else None
                ),
                "finished_at": (
                    datetime.fromtimestamp(self.finished_at, tz=timezone.utc).isoformat()
                    if self.finished_at
                    else None
                ),
                "elapsed_seconds": round(self.elapsed_seconds(), 2),
                "transactions_per_second": self.throughput(),
                "error": self.error,
            }


def _percentile(ordered_samples: List[float], percentile: float) -> float:
    """Linearly interpolated percentile on an already sorted list.

    This is the same definition numpy uses by default, so the latency figures
    the dashboard shows and the ones the training report records are comparable.
    """
    if not ordered_samples:
        return 0.0
    if len(ordered_samples) == 1:
        return ordered_samples[0]
    rank = (percentile / 100.0) * (len(ordered_samples) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered_samples) - 1)
    weight = rank - lower
    return ordered_samples[lower] * (1 - weight) + ordered_samples[upper] * weight
