"""Buffered Supabase writer (PRD FR-012).

Writes happen on a background thread so network latency never counts against the
50 ms per-transaction inference budget. If Supabase is not configured the writer
degrades into a no-op and the API serves its in-memory rolling window instead,
which keeps local development and the demo working without credentials.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ..config import settings

logger = logging.getLogger(__name__)

FLUSH_INTERVAL_SECONDS = 1.0
QUEUE_MAX_SIZE = 10_000


@dataclass
class _Item:
    table: str
    payload: Dict[str, Any]
    conflict_key: Optional[str] = None


class SupabaseWriter:
    """Batches rows and flushes them to Supabase PostgreSQL."""

    def __init__(self, batch_size: Optional[int] = None) -> None:
        self.batch_size = batch_size or settings.persist_batch_size
        self._queue: "queue.Queue[Optional[_Item]]" = queue.Queue(maxsize=QUEUE_MAX_SIZE)
        self._client = None
        self._thread: Optional[threading.Thread] = None
        self._stopping = threading.Event()
        self.succeeded = 0
        self.failed = 0
        self.dropped = 0
        self.last_error: Optional[str] = None

        if settings.supabase_enabled:
            self._client = self._create_client()

        if self._client is not None:
            self._thread = threading.Thread(
                target=self._run, name="supabase-writer", daemon=True
            )
            self._thread.start()
            logger.info("Supabase writer started (batch size %s)", self.batch_size)
        else:
            logger.warning(
                "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). "
                "Stream results will be kept in memory only."
            )

    # -- public API ----------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def write_transaction(self, payload: Dict[str, Any]) -> None:
        self._enqueue(_Item("transactions", payload))

    def write_alert(self, payload: Dict[str, Any]) -> None:
        self._enqueue(_Item("fraud_alerts", payload))

    def write_investigation_case(self, payload: Dict[str, Any]) -> None:
        self._enqueue(_Item("investigation_cases", payload, conflict_key="id"))

    def write_investigation_note(self, payload: Dict[str, Any]) -> None:
        self._enqueue(_Item("investigation_notes", payload))

    def update_alert_status(self, transaction_id: str, status: str) -> bool:
        """Synchronously mirror analyst triage when Supabase is enabled."""
        if not self.enabled:
            return False
        try:
            self._client.table("fraud_alerts").update({"status": status}).eq(
                "transaction_id", transaction_id
            ).execute()
            return True
        except Exception as error:  # pragma: no cover - network dependent
            self.failed += 1
            self.last_error = f"fraud_alerts update: {error}"
            logger.error("Could not update alert %s: %s", transaction_id, error)
            return False

    def write_account_risk(self, payload: Dict[str, Any]) -> None:
        self._enqueue(_Item("account_risk", payload, conflict_key="account_id"))

    def write_model_metrics(self, payload: Dict[str, Any]) -> None:
        self._enqueue(_Item("model_metrics", payload))

    def stats(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "queued": self._queue.qsize(),
            "succeeded": self.succeeded,
            "failed": self.failed,
            "dropped": self.dropped,
            "last_error": self.last_error,
        }

    def flush(self, timeout: float = 5.0) -> None:
        """Block until the queue drains (best effort)."""
        if not self.enabled:
            return
        deadline = time.time() + timeout
        while not self._queue.empty() and time.time() < deadline:
            time.sleep(0.05)

    def close(self, timeout: float = 5.0) -> None:
        if not self.enabled:
            return
        self.flush(timeout)
        self._stopping.set()
        self._queue.put(None)
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    # -- internals -----------------------------------------------------------

    def _create_client(self):
        try:
            from supabase import create_client
        except ImportError:
            logger.error(
                "The 'supabase' package is not installed; persistence is disabled. "
                "Install it with: pip install -r requirements.txt"
            )
            return None
        try:
            return create_client(settings.supabase_url, settings.supabase_service_role_key)
        except Exception as error:  # pragma: no cover - network/credential dependent
            logger.error("Could not create the Supabase client: %s", error)
            self.last_error = str(error)
            return None

    def _enqueue(self, item: _Item) -> None:
        if not self.enabled:
            return
        try:
            self._queue.put_nowait(item)
        except queue.Full:
            self.dropped += 1
            if self.dropped % 100 == 1:
                logger.warning(
                    "Supabase write queue is full; dropped %s rows so far", self.dropped
                )

    def _run(self) -> None:
        pending: List[_Item] = []
        last_flush = time.time()

        while not self._stopping.is_set() or not self._queue.empty():
            timeout = max(FLUSH_INTERVAL_SECONDS - (time.time() - last_flush), 0.01)
            try:
                item = self._queue.get(timeout=timeout)
            except queue.Empty:
                item = None
            else:
                if item is None:  # shutdown sentinel
                    self._stopping.set()
                else:
                    pending.append(item)

            due = (
                len(pending) >= self.batch_size
                or (pending and time.time() - last_flush >= FLUSH_INTERVAL_SECONDS)
                or (pending and self._stopping.is_set())
            )
            if due:
                self._flush_batch(pending)
                pending = []
                last_flush = time.time()

        if pending:
            self._flush_batch(pending)

    def _flush_batch(self, items: List[_Item]) -> None:
        grouped: Dict[tuple, List[Dict[str, Any]]] = {}
        for item in items:
            grouped.setdefault((item.table, item.conflict_key), []).append(item.payload)

        for (table, conflict_key), rows in grouped.items():
            try:
                if conflict_key:
                    # Multiple updates for one case/account may share a batch.
                    # Keep only the newest payload so one upsert command never
                    # attempts to affect the same conflict row twice.
                    deduplicated: Dict[Any, Dict[str, Any]] = {}
                    for row in rows:
                        deduplicated[row.get(conflict_key)] = row
                    rows = list(deduplicated.values())
                query = self._client.table(table)
                if conflict_key:
                    query.upsert(rows, on_conflict=conflict_key).execute()
                else:
                    query.insert(rows).execute()
                self.succeeded += len(rows)
            except Exception as error:  # pragma: no cover - network dependent
                self.failed += len(rows)
                self.last_error = f"{table}: {error}"
                logger.error("Supabase write to '%s' failed (%s rows): %s", table, len(rows), error)


_writer: Optional[SupabaseWriter] = None
_lock = threading.Lock()


def get_writer() -> SupabaseWriter:
    global _writer
    if _writer is None:
        with _lock:
            if _writer is None:
                _writer = SupabaseWriter()
    return _writer
