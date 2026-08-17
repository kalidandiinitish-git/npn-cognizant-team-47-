"""The pseudo-stream processing loop (PRD pseudo_streaming.processing_loop).

One transaction at a time:
    receive -> validate -> transform -> infer -> risk score -> risk level ->
    account risk -> persist -> emit realtime event -> next
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from ..config import DATA_DIR, UPLOAD_DIR, settings
from ..uploads import reference_for, resolve_within


def _upload_reference(path: Path) -> str:
    """How the uploads listing addresses *path*, or its bare name if it is not
    an upload at all (the held-out split, or a file named by DATA_PATH).

    Both sides are resolved before comparing: the stored source has been through
    ``Path.resolve()`` and the uploads root has not, which on macOS is the
    difference between /private/var/... and /var/... and would leave every
    upload reporting a bare name the dashboard cannot match.
    """
    try:
        return reference_for(UPLOAD_DIR.resolve(), path.resolve())
    except (ValueError, OSError):
        return path.name
from ..inference.predictor import FraudPredictor, ModelNotTrainedError, get_predictor
from ..investigations import InvestigationStore
from ..persistence.supabase_client import SupabaseWriter, get_writer
from ..risk.scoring import (
    AccountRiskEngine,
    alert_type_for,
    assess,
    behaviour_reason_codes,
)
from .generator import (
    TransactionEvent,
    count_transactions,
    inspect_source,
    transaction_stream,
)
from .state import StreamConfig, StreamState, StreamStatus

logger = logging.getLogger(__name__)


class UnstreamableSourceError(ValueError):
    """The requested source exists but cannot produce a single scored row.

    Distinct from :class:`FileNotFoundError`: the file is there, it is simply
    not in a shape the model can read. Raised before the stream thread starts so
    the caller gets a reason instead of a run that ends instantly with nothing
    in it.
    """

#: Columns of ``public.transactions`` (supabase/migrations/0001_init.sql). Only
#: these are sent to Supabase; ``id`` and ``created_at`` have defaults but the
#: engine supplies ``created_at`` itself so the row keeps its ingestion time.
TRANSACTION_COLUMNS = (
    "transaction_ref",
    "sequence",
    "account_id",
    "card_last4",
    "transaction_amount",
    "merchant",
    "merchant_category",
    "location",
    "channel",
    "transaction_time",
    "model_score",
    "risk_score",
    "risk_level",
    "decision",
    "is_fraud",
    "inference_latency_ms",
    "processing_latency_ms",
    "actual_label",
    "account_risk_level",
    "behaviour",
    "created_at",
)


class StreamProcessor:
    """Owns the stream lifecycle, the risk state and the persistence handoff."""

    def __init__(
        self,
        predictor: Optional[FraudPredictor] = None,
        writer: Optional[SupabaseWriter] = None,
    ) -> None:
        self.state = StreamState()
        self.accounts = AccountRiskEngine()
        self.investigations = InvestigationStore()
        self._predictor = predictor
        self._writer = writer
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._source_rows = 0
        #: (succeeded, failed) on the writer when the current run started.
        self._persist_baseline = (0, 0)

    # -- dependencies --------------------------------------------------------

    @property
    def predictor(self) -> FraudPredictor:
        if self._predictor is None:
            self._predictor = get_predictor()
        return self._predictor

    @property
    def writer(self) -> SupabaseWriter:
        if self._writer is None:
            self._writer = get_writer()
        return self._writer

    # -- lifecycle -----------------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def resolve_source(self, source: Optional[str] = None) -> Path:
        """Pick the stream source, preferring the held-out test split.

        A relative name is looked up in ``data/`` and then ``data/uploads/``, so a
        file added through the upload endpoint can be streamed by name. Uploads
        are namespaced by uploader, so that name may carry one owner directory
        (``<owner>/<file>.csv``). Absolute paths are accepted for programmatic
        use; requests arriving over HTTP are restricted by the API schema.

        Every relative candidate is checked for containment after resolution.
        The schema is the first guard, not the only one: a symlink planted inside
        the data tree would otherwise resolve to anything on the host.
        """
        if source:
            candidate = Path(source)
            if candidate.is_absolute():
                if candidate.exists():
                    return candidate
                raise FileNotFoundError(f"Stream source not found: {candidate}")

            for base in (DATA_DIR, UPLOAD_DIR):
                resolved = resolve_within(base, source)
                if resolved is not None:
                    return resolved
            raise FileNotFoundError(
                f"Stream source '{source}' was not found in {DATA_DIR.name}/ or "
                f"{DATA_DIR.name}/{UPLOAD_DIR.name}/."
            )

        if settings.stream_data_path.exists():
            return settings.stream_data_path

        dataset = settings.resolve_dataset_path()
        if dataset is not None:
            logger.warning(
                "Held-out stream file %s is missing; falling back to the full dataset %s. "
                "Run training to generate the test split.",
                settings.stream_data_path,
                dataset,
            )
            return dataset
        raise FileNotFoundError(
            "No stream source available. Run training to create data/stream_test.csv "
            "or set DATA_PATH to the dataset."
        )

    def start(
        self,
        source: Optional[str] = None,
        limit: Optional[int] = None,
        delay_ms: Optional[int] = None,
        skip: int = 0,
        persist: bool = True,
        reset: bool = True,
        actor: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        """Start streaming on a background thread.

        *actor* is the account that asked for the run, recorded so the dashboard
        can say whose stream is live. There is one stream per engine, so a start
        replaces what everyone else is watching; leaving that anonymous is what
        made it look like the dashboard had changed on its own.
        """
        with self._lock:
            if self.is_running:
                return {
                    "started": False,
                    "reason": "A stream is already running.",
                    **self.status(),
                }

            resolved = self.resolve_source(source)
            # Refuse a file the generator would reject row by row. Without this
            # an out-of-schema CSV starts a run that finishes in under a
            # millisecond having processed nothing, reports "completed" with no
            # error, and leaves the dashboard blank with no way to find out why.
            inspection = inspect_source(resolved)
            if not inspection.streamable:
                raise UnstreamableSourceError(inspection.rejection_reason())

            # Fail fast with a clear message if the model was never trained.
            self.predictor

            capped_limit = min(
                limit or settings.stream_max_transactions,
                settings.stream_max_transactions,
            )
            config = StreamConfig(
                source=str(resolved),
                limit=capped_limit,
                delay_ms=settings.stream_delay_ms if delay_ms is None else max(int(delay_ms), 0),
                skip=max(int(skip), 0),
                persist=bool(persist),
                run_id=uuid4().hex[:6].upper(),
                started_by=dict(actor) if actor else None,
            )

            if reset:
                self.state.reset_counters()
                self.accounts.reset()
                # Cases belong to the run that raised their alerts. Without this
                # the workbench would list investigations whose alerts have just
                # been cleared from the live buffer.
                self.investigations.reset()

            self._stop_event.clear()
            if self.writer.enabled:
                self._persist_baseline = (self.writer.succeeded, self.writer.failed)
            # Counted here rather than on the thread: the dashboard reads the
            # total in the same breath as it gets "started", and computing it
            # inside _run left that first read showing the previous run's file.
            self._source_rows = count_transactions(resolved)
            self.state.begin(config)
            self._thread = threading.Thread(
                target=self._run, args=(config,), name="pseudo-stream", daemon=True
            )
            self._thread.start()

        return {"started": True, **self.status()}

    def stop(self, timeout: float = 5.0) -> Dict[str, Any]:
        """Request a clean stop and wait briefly for the loop to finish."""
        self._stop_event.set()
        self.state.request_stop()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=timeout)
        if self.state.status == StreamStatus.STOPPING:
            self.state.finish(StreamStatus.IDLE)
        return {"stopped": True, **self.status()}

    def _sync_persistence_counters(self) -> None:
        """Refresh the run's persistence counters from the writer.

        The writer is the only component that knows what actually reached
        Postgres, and its totals are cumulative across runs, so the run-scoped
        figures are the delta since this run began.
        """
        if not self.writer.enabled:
            return
        succeeded, failed = self.writer.succeeded, self.writer.failed
        base_succeeded, base_failed = self._persist_baseline
        self.state.set_persistence(succeeded - base_succeeded, failed - base_failed)

    def status(self) -> Dict[str, Any]:
        self._sync_persistence_counters()
        snapshot = self.state.status_snapshot()
        snapshot["is_running"] = self.is_running
        snapshot["source_total_rows"] = self._source_rows
        # The bare file name of what is being replayed. The dashboard marks
        # which uploaded dataset is live from this; deriving it in the browser
        # would mean parsing a host path with the wrong separator rules.
        configured_source = snapshot.get("config", {}).get("source")
        snapshot["source_name"] = Path(configured_source).name if configured_source else None
        # The same file addressed the way the uploads listing addresses it,
        # "<owner>/<file>.csv". The dashboard badges which upload is live by
        # matching on this: bare names stopped identifying a file uniquely once
        # two accounts could each own a transactions.csv.
        snapshot["source_ref"] = (
            _upload_reference(Path(configured_source)) if configured_source else None
        )
        return snapshot

    # -- the loop ------------------------------------------------------------

    def _empty_run_reason(self, config: StreamConfig) -> str:
        """Why a run ended having scored nothing.

        Inspection already refused the sources that cannot parse at all, so what
        reaches here is a range problem or a file whose tail is malformed. Either
        way "completed, 0 transactions, no error" is indistinguishable from a
        healthy stream nobody can see, and the demo needs the difference.
        """
        name = Path(config.source).name
        if config.skip and config.skip >= self._source_rows:
            return (
                f"skip={config.skip} is past the end of {name}, which has "
                f"{self._source_rows} rows. Nothing was left to stream."
            )
        if self.state.invalid_records:
            return (
                f"No transaction in {name} could be scored: all "
                f"{self.state.invalid_records} rows read were rejected."
            )
        return f"{name} produced no transactions to score."

    def _run(self, config: StreamConfig) -> None:
        logger.info(
            "Pseudo-stream starting: source=%s rows=%s limit=%s delay=%sms",
            config.source,
            self._source_rows,
            config.limit,
            config.delay_ms,
        )
        try:
            stream = transaction_stream(
                Path(config.source),
                limit=config.limit,
                delay_ms=config.delay_ms,
                skip=config.skip,
                should_continue=lambda: not self._stop_event.is_set(),
                on_invalid=lambda _row, _reason: self.state.record_invalid(),
                run_id=config.run_id,
            )
            for event in stream:
                self.process_event(event, persist=config.persist)

            if self._stop_event.is_set():
                self.state.finish(StreamStatus.IDLE)
                logger.info("Pseudo-stream stopped after %s transactions", self.state.processed)
            elif self.state.processed == 0:
                reason = self._empty_run_reason(config)
                self.state.finish(StreamStatus.ERROR, reason)
                logger.error("Pseudo-stream produced nothing: %s", reason)
            else:
                self.state.finish(StreamStatus.COMPLETED)
                logger.info("Pseudo-stream completed: %s transactions", self.state.processed)
        except ModelNotTrainedError as error:
            self.state.finish(StreamStatus.ERROR, str(error))
            logger.error("Pseudo-stream aborted: %s", error)
        except Exception as error:  # pragma: no cover - defensive
            self.state.finish(StreamStatus.ERROR, str(error))
            logger.exception("Pseudo-stream failed: %s", error)
        finally:
            if self.writer.enabled:
                self.writer.flush(timeout=5.0)
                self._sync_persistence_counters()
                logger.info("Supabase writer stats: %s", self.writer.stats())

    # -- single transaction pipeline -----------------------------------------

    def process_event(
        self,
        event: TransactionEvent,
        persist: bool = True,
        create_investigation: bool = True,
    ) -> Dict[str, Any]:
        """Score one transaction and fold it into all downstream state."""
        loop_started = time.perf_counter()

        prediction = self.predictor.predict(event.model_record())
        assessment = assess(prediction.probability, prediction.threshold)

        identity = event.identity
        account_id = str(identity.get("account_id", "UNKNOWN"))

        features = self.accounts.behavioural_features(
            account_id=account_id,
            amount=event.amount,
            event_time=event.event_time,
        )
        profile = self.accounts.update(
            account_id=account_id,
            amount=event.amount,
            event_time=event.event_time,
            risk_score=assessment.risk_score,
            suspicious=assessment.alert_required,
            location=str(identity.get("location", "")),
            merchant_category=str(identity.get("merchant_category", "")),
            observed_at=event.transaction_time,
        )

        processing_latency_ms = (time.perf_counter() - loop_started) * 1000.0

        row = self._build_transaction_row(
            event=event,
            assessment=assessment,
            prediction_latency_ms=prediction.inference_latency_ms,
            processing_latency_ms=processing_latency_ms,
            features=features,
            profile_risk_level=profile.risk_level,
        )

        alert = None
        investigation = None
        if assessment.alert_required:
            alert = self._build_alert_row(event, assessment, features, account_id)
            if create_investigation:
                explain = getattr(self.predictor, "explain", None)
                if callable(explain):
                    explanation = explain(
                        event.model_record(), model_probability=prediction.probability
                    )
                else:
                    explanation = {
                        "available": False,
                        "method": None,
                        "reason": "The active estimator does not provide model contributions.",
                        "features": [],
                        "model_name": prediction.model_name,
                        "model_version": prediction.model_version,
                    }
                reasons = behaviour_reason_codes(assessment, features)
                investigation = self.investigations.create_from_alert(
                    alert=alert,
                    transaction=row,
                    explanation=explanation,
                    reason_codes=reasons,
                )
                alert["case_id"] = investigation["case_id"]
                alert["explanation_available"] = bool(explanation.get("available"))

        self.state.record_transaction(
            row=row,
            latency_ms=prediction.inference_latency_ms,
            risk_level=assessment.risk_level,
            flagged=assessment.alert_required,
            label=event.label,
            alert=alert,
        )

        if persist and self.writer.enabled:
            self.writer.write_transaction(self._persistable_transaction(row))
            if alert is not None:
                self.writer.write_alert(self._persistable_alert(alert))
            if investigation is not None:
                self.writer.write_investigation_case(
                    self.investigations.persistable(investigation)
                )
            # Only sync accounts that carry risk, to keep write volume sane.
            if profile.risk_level != "low" or profile.suspicious_count:
                self.writer.write_account_risk(
                    {
                        **profile.as_dict(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )

        return row

    def _build_transaction_row(
        self,
        event: TransactionEvent,
        assessment,
        prediction_latency_ms: float,
        processing_latency_ms: float,
        features,
        profile_risk_level: str,
    ) -> Dict[str, Any]:
        identity = event.identity
        return {
            "transaction_ref": event.transaction_id,
            "sequence": event.sequence,
            "source_row": event.source_row,
            "run_id": event.run_id,
            "account_id": identity.get("account_id"),
            "card_last4": identity.get("card_last4"),
            "transaction_amount": round(event.amount, 2),
            "merchant": identity.get("merchant"),
            "merchant_category": identity.get("merchant_category"),
            "location": identity.get("location"),
            "channel": identity.get("channel"),
            "transaction_time": event.transaction_time,
            "model_score": assessment.probability,
            "risk_score": assessment.risk_score,
            "risk_level": assessment.risk_level,
            "decision": assessment.action,
            "is_fraud": assessment.alert_required,
            "inference_latency_ms": round(prediction_latency_ms, 3),
            "processing_latency_ms": round(processing_latency_ms, 3),
            "actual_label": event.label,
            "account_risk_level": profile_risk_level,
            "behaviour": features.as_dict(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    def _build_alert_row(
        self, event: TransactionEvent, assessment, features, account_id: str
    ) -> Dict[str, Any]:
        return {
            "id": str(uuid4()),
            "transaction_id": event.transaction_id,
            "account_id": account_id,
            "risk_score": assessment.risk_score,
            "risk_level": assessment.risk_level,
            "alert_type": alert_type_for(assessment, features),
            "status": "open",
            "merchant": event.identity.get("merchant"),
            "transaction_amount": round(event.amount, 2),
            "location": event.identity.get("location"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _persistable_transaction(row: Dict[str, Any]) -> Dict[str, Any]:
        """Project a scored row onto the columns ``public.transactions`` has.

        An allowlist rather than a denylist: PostgREST rejects the whole insert
        when a payload carries an unknown column, and inserts are batched, so a
        single stray key silently costs every row in its batch. Adding a field
        for the dashboard must never be able to break persistence.
        """
        return {
            column: row.get(column)
            for column in TRANSACTION_COLUMNS
            if column in row
        }

    @staticmethod
    def _persistable_alert(alert: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(alert)
        payload.pop("explanation_available", None)
        return payload

    # -- reads for the API ---------------------------------------------------

    def recent_transactions(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self.state.recent_transactions(limit)

    def recent_alerts(self, limit: int = 50, level: Optional[str] = None) -> List[Dict[str, Any]]:
        alerts = self.state.recent_alerts(limit if level is None else max(limit * 4, limit))
        if level:
            alerts = [alert for alert in alerts if alert.get("risk_level") == level]
        return alerts[:limit]

    def update_alert_status(
        self, transaction_id: str, status: str, actor: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        updated = self.state.update_alert_status(
            transaction_id=transaction_id, status=status
        )
        if updated is None:
            return None
        case = self.investigations.set_status_for_transaction(
            transaction_id, status, actor
        )
        if self.writer.enabled:
            self.writer.update_alert_status(transaction_id, status)
            if case is not None:
                self.writer.write_investigation_case(
                    self.investigations.persistable(case)
                )
        return updated

    def persist_investigation(
        self, case: Dict[str, Any], note: Optional[Dict[str, Any]] = None
    ) -> None:
        if not self.writer.enabled:
            return
        self.writer.write_investigation_case(self.investigations.persistable(case))
        if note is not None:
            self.writer.write_investigation_note(
                self.investigations.persistable_note(note)
            )

    def high_risk_accounts(self, minimum_level: str = "high", limit: int = 50) -> List[Dict[str, Any]]:
        return [
            {**profile.as_dict(), "signals": self.accounts.signal_breakdown(profile.account_id)}
            for profile in self.accounts.high_risk_accounts(minimum_level, limit)
        ]

    def metrics(self) -> Dict[str, Any]:
        """Everything the dashboard widgets need in a single response."""
        latency = self.state.latency_stats()
        distribution = self.state.risk_distribution()
        flagged = sum(
            entry["count"] for entry in distribution if entry["level"] in {"high", "critical"}
        )
        critical = next(
            (entry["count"] for entry in distribution if entry["level"] == "critical"), 0
        )
        processed = self.state.processed
        account_levels = self.accounts.count_by_level()

        model_info: Dict[str, Any]
        try:
            model_info = self.predictor.info()
        except ModelNotTrainedError as error:
            model_info = {"error": str(error)}

        return {
            "stream": self.status(),
            "totals": {
                "total_transactions": processed,
                "fraud_transactions": flagged,
                "fraud_detection_rate": round(100.0 * flagged / processed, 3) if processed else 0.0,
                "critical_alerts": critical,
                "alerts_raised": self.state.alerts_raised,
                "invalid_records": self.state.invalid_records,
                "high_risk_accounts": account_levels.get("high", 0)
                + account_levels.get("critical", 0),
                "monitored_accounts": len(self.accounts.all_profiles()),
                "transactions_per_second": self.state.throughput(),
            },
            "latency": latency,
            "risk_distribution": distribution,
            "account_risk_levels": account_levels,
            "live_quality": self.state.live_quality(),
            "timeline": self.state.timeline(),
            "model": model_info,
            "persistence": self.writer.stats(),
            "investigations": self.investigations.metrics(),
        }


_processor: Optional[StreamProcessor] = None
_processor_lock = threading.Lock()


def get_processor() -> StreamProcessor:
    global _processor
    if _processor is None:
        with _processor_lock:
            if _processor is None:
                _processor = StreamProcessor()
    return _processor
