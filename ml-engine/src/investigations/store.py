"""Thread-safe, process-local fraud investigation workflow.

The stream and dashboard already operate without Supabase, so investigations use
an in-memory source of truth and optionally write through to Postgres. Every
mutation increments a version to prevent two analysts silently overwriting one
another.
"""

from __future__ import annotations

import copy
import threading
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4


class InvestigationNotFound(KeyError):
    """Raised when a requested investigation case does not exist."""


class InvestigationConflict(RuntimeError):
    """Raised when an optimistic version check fails."""


# A case still needs work while it sits in one of these states. Resolved and
# dismissed cases are closed, so a later alert for the same transaction is a
# genuinely new investigation rather than a duplicate.
ACTIVE_STATUSES = frozenset({"open", "investigating"})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(actor: Optional[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    source = actor or {}
    return {
        "id": str(source.get("id") or "system"),
        "email": source.get("email"),
    }


class InvestigationStore:
    """Owns case lifecycle, notes, explanations, and feedback metrics."""

    def __init__(self, limit: int = 2_000) -> None:
        self._lock = threading.RLock()
        self._limit = max(int(limit), 100)
        self._cases: Dict[str, Dict[str, Any]] = {}
        self._order: List[str] = []
        self._alert_index: Dict[str, str] = {}
        self._transaction_index: Dict[str, List[str]] = {}

    def create_from_alert(
        self,
        alert: Dict[str, Any],
        transaction: Dict[str, Any],
        explanation: Dict[str, Any],
        reason_codes: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        transaction_id = str(alert.get("transaction_id") or "")
        with self._lock:
            # Restarting a stream without resetting replays rows that were
            # already scored. Reuse the open case instead of opening a second
            # one for the same transaction.
            existing = self._active_case_for_transaction(transaction_id)
            if existing is not None:
                return copy.deepcopy(existing)
            return self._create(alert, transaction, explanation, reason_codes, transaction_id)

    def _create(
        self,
        alert: Dict[str, Any],
        transaction: Dict[str, Any],
        explanation: Dict[str, Any],
        reason_codes: List[Dict[str, Any]],
        transaction_id: str,
    ) -> Dict[str, Any]:
        created = _now()
        case_id = str(uuid4())
        alert_id = str(alert.get("id") or uuid4())
        transaction_snapshot = copy.deepcopy(transaction)
        # Ground truth is evaluation-only and must not bias an analyst.
        transaction_snapshot.pop("actual_label", None)
        case = {
            "case_id": case_id,
            "case_number": f"FSA-{created[:4]}-{case_id[:8].upper()}",
            "alert_id": alert_id,
            "transaction_id": transaction_id,
            "account_id": alert.get("account_id"),
            "risk_score": alert.get("risk_score"),
            "risk_level": alert.get("risk_level"),
            "alert_type": alert.get("alert_type"),
            "priority": "urgent" if alert.get("risk_level") == "critical" else "high",
            "status": "open",
            "assignee": None,
            "transaction": transaction_snapshot,
            "alert": copy.deepcopy(alert),
            "explanation": copy.deepcopy(explanation),
            "reason_codes": copy.deepcopy(reason_codes),
            "notes": [],
            "resolution": None,
            "events": [
                {
                    "id": str(uuid4()),
                    "type": "case_created",
                    "actor": {"id": "system", "email": None},
                    "detail": "Investigation opened automatically from a fraud alert.",
                    "created_at": created,
                }
            ],
            "created_at": created,
            "updated_at": created,
            "version": 1,
        }
        with self._lock:
            self._cases[case_id] = case
            self._order.insert(0, case_id)
            self._alert_index[alert_id] = case_id
            self._transaction_index.setdefault(transaction_id, []).insert(0, case_id)
            while len(self._order) > self._limit:
                removed = self._order.pop()
                stale = self._cases.pop(removed, None)
                if stale:
                    self._alert_index.pop(str(stale.get("alert_id")), None)
                    refs = self._transaction_index.get(str(stale.get("transaction_id")), [])
                    self._transaction_index[str(stale.get("transaction_id"))] = [
                        item for item in refs if item != removed
                    ]
            return copy.deepcopy(case)

    def list_cases(
        self,
        status: Optional[str] = None,
        risk_level: Optional[str] = None,
        assignee_id: Optional[str] = None,
        unassigned: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> Dict[str, Any]:
        with self._lock:
            rows = [self._cases[item] for item in self._order if item in self._cases]
            if status:
                rows = [row for row in rows if row.get("status") == status]
            if risk_level:
                rows = [row for row in rows if row.get("risk_level") == risk_level]
            if assignee_id:
                rows = [
                    row
                    for row in rows
                    if (row.get("assignee") or {}).get("id") == assignee_id
                ]
            if unassigned:
                rows = [row for row in rows if not row.get("assignee")]
            total = len(rows)
            selected = rows[max(offset, 0) : max(offset, 0) + max(limit, 0)]
            return {
                "count": len(selected),
                "total": total,
                "cases": [self._summary(row) for row in selected],
            }

    def get(self, case_id: str) -> Dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._require(case_id))

    def reset(self) -> None:
        """Drop every in-memory case.

        A stream run that resets its counters also clears the transaction feed,
        the alert buffer and account risk. Cases have to go with them, otherwise
        the workbench keeps showing investigations for alerts that no longer
        exist. Rows already written to Supabase are the durable history and are
        deliberately left untouched.
        """
        with self._lock:
            self._cases.clear()
            self._order.clear()
            self._alert_index.clear()
            self._transaction_index.clear()

    def assign(
        self,
        case_id: str,
        assignee_id: Optional[str],
        assignee_email: Optional[str],
        actor: Dict[str, Any],
        expected_version: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            case = self._require(case_id)
            self._check_version(case, expected_version)
            now = _now()
            case["assignee"] = (
                {
                    "id": assignee_id,
                    "email": assignee_email,
                    "assigned_at": now,
                    "assigned_by": _actor(actor),
                }
                if assignee_id
                else None
            )
            self._record(
                case,
                "assignment_changed",
                actor,
                f"Assigned to {assignee_email or assignee_id}." if assignee_id else "Assignment cleared.",
            )
            return copy.deepcopy(case)

    def add_note(
        self,
        case_id: str,
        body: str,
        actor: Dict[str, Any],
        expected_version: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            case = self._require(case_id)
            self._check_version(case, expected_version)
            note = {
                "id": str(uuid4()),
                "case_id": case_id,
                "author": _actor(actor),
                "body": body.strip(),
                "created_at": _now(),
            }
            case["notes"].append(note)
            self._record(case, "note_added", actor, "Analyst note added.")
            result = copy.deepcopy(case)
            result["created_note"] = copy.deepcopy(note)
            return result

    def set_status(
        self,
        case_id: str,
        status: str,
        actor: Dict[str, Any],
        expected_version: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            case = self._require(case_id)
            self._check_version(case, expected_version)
            previous = case["status"]
            case["status"] = status
            case["alert"]["status"] = status
            self._record(case, "status_changed", actor, f"Status changed from {previous} to {status}.")
            return copy.deepcopy(case)

    def set_status_for_transaction(
        self, transaction_id: str, status: str, actor: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        with self._lock:
            ids = self._transaction_index.get(transaction_id) or []
            if not ids:
                return None
            case = self._require(ids[0])
            previous = case["status"]
            case["status"] = status
            case["alert"]["status"] = status
            self._record(case, "status_changed", actor, f"Alert triage changed {previous} to {status}.")
            return copy.deepcopy(case)

    def resolve(
        self,
        case_id: str,
        code: str,
        summary: str,
        confidence: Optional[float],
        actor: Dict[str, Any],
        expected_version: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            case = self._require(case_id)
            self._check_version(case, expected_version)
            now = _now()
            case["resolution"] = {
                "code": code,
                "summary": summary.strip(),
                "confidence": confidence,
                "resolved_by": _actor(actor),
                "resolved_at": now,
            }
            case["status"] = "dismissed" if code == "duplicate" else "resolved"
            case["alert"]["status"] = case["status"]
            self._record(case, "case_resolved", actor, f"Resolution recorded: {code}.")
            return copy.deepcopy(case)

    def metrics(self) -> Dict[str, Any]:
        with self._lock:
            rows = list(self._cases.values())
            statuses = Counter(str(row.get("status")) for row in rows)
            risks = Counter(str(row.get("risk_level")) for row in rows)
            reasons = Counter(
                reason.get("code")
                for row in rows
                for reason in row.get("reason_codes", [])
                if reason.get("code")
            )
            resolutions = Counter(
                (row.get("resolution") or {}).get("code")
                for row in rows
                if row.get("resolution")
            )
            resolution_seconds: List[float] = []
            for row in rows:
                resolution = row.get("resolution") or {}
                if not resolution.get("resolved_at"):
                    continue
                try:
                    start = datetime.fromisoformat(row["created_at"])
                    end = datetime.fromisoformat(resolution["resolved_at"])
                    resolution_seconds.append(max((end - start).total_seconds(), 0.0))
                except (TypeError, ValueError):
                    continue
            resolved = sum(resolutions.values())
            confirmed = resolutions.get("confirmed_fraud", 0)
            false_positive = resolutions.get("false_positive", 0)
            return {
                "total": len(rows),
                "open": statuses.get("open", 0),
                "investigating": statuses.get("investigating", 0),
                "resolved": statuses.get("resolved", 0),
                "dismissed": statuses.get("dismissed", 0),
                "unassigned": sum(1 for row in rows if not row.get("assignee")),
                "by_risk_level": dict(risks),
                "by_reason_code": dict(reasons),
                "by_resolution": {key: value for key, value in resolutions.items() if key},
                "confirmed_fraud": confirmed,
                "false_positives": false_positive,
                "analyst_confirmation_rate": round(confirmed / resolved, 4) if resolved else None,
                "average_resolution_seconds": (
                    round(sum(resolution_seconds) / len(resolution_seconds), 2)
                    if resolution_seconds
                    else None
                ),
            }

    @staticmethod
    def persistable(case: Dict[str, Any]) -> Dict[str, Any]:
        assignee = case.get("assignee") or {}
        resolution = case.get("resolution") or {}
        return {
            "id": case["case_id"],
            "case_number": case["case_number"],
            "alert_id": case.get("alert_id"),
            "transaction_id": case.get("transaction_id"),
            "account_id": case.get("account_id"),
            "risk_score": case.get("risk_score"),
            "risk_level": case.get("risk_level"),
            "alert_type": case.get("alert_type"),
            "priority": case.get("priority"),
            "status": case.get("status"),
            "assignee_id": assignee.get("id"),
            "assignee_email": assignee.get("email"),
            "transaction_snapshot": case.get("transaction"),
            "alert_snapshot": case.get("alert"),
            "explanation": case.get("explanation"),
            "reason_codes": case.get("reason_codes"),
            "resolution_code": resolution.get("code"),
            "resolution_summary": resolution.get("summary"),
            "analyst_confidence": resolution.get("confidence"),
            "resolved_by": (resolution.get("resolved_by") or {}).get("id"),
            "resolved_at": resolution.get("resolved_at"),
            "version": case.get("version"),
            "created_at": case.get("created_at"),
            "updated_at": case.get("updated_at"),
        }

    @staticmethod
    def persistable_note(note: Dict[str, Any]) -> Dict[str, Any]:
        author = note.get("author") or {}
        return {
            "id": note.get("id"),
            "case_id": note.get("case_id"),
            "author_id": author.get("id"),
            "author_email": author.get("email"),
            "body": note.get("body"),
            "created_at": note.get("created_at"),
        }

    def _active_case_for_transaction(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        """Return the still-open case for a transaction, if one exists."""
        if not transaction_id:
            return None
        for case_id in self._transaction_index.get(transaction_id, []):
            case = self._cases.get(case_id)
            if case is not None and case.get("status") in ACTIVE_STATUSES:
                return case
        return None

    def _require(self, case_id: str) -> Dict[str, Any]:
        case = self._cases.get(case_id)
        if case is None:
            raise InvestigationNotFound(case_id)
        return case

    @staticmethod
    def _check_version(case: Dict[str, Any], expected: Optional[int]) -> None:
        if expected is not None and int(expected) != int(case.get("version", 0)):
            raise InvestigationConflict(
                f"Case changed from version {expected} to {case.get('version')}; refresh and retry."
            )

    @staticmethod
    def _record(case: Dict[str, Any], event_type: str, actor: Dict[str, Any], detail: str) -> None:
        now = _now()
        case["events"].append(
            {
                "id": str(uuid4()),
                "type": event_type,
                "actor": _actor(actor),
                "detail": detail,
                "created_at": now,
            }
        )
        case["updated_at"] = now
        case["version"] = int(case.get("version", 0)) + 1

    @staticmethod
    def _summary(case: Dict[str, Any]) -> Dict[str, Any]:
        reasons = case.get("reason_codes") or []
        return {
            "case_id": case.get("case_id"),
            "case_number": case.get("case_number"),
            "alert_id": case.get("alert_id"),
            "transaction_id": case.get("transaction_id"),
            "account_id": case.get("account_id"),
            "risk_score": case.get("risk_score"),
            "risk_level": case.get("risk_level"),
            "alert_type": case.get("alert_type"),
            "priority": case.get("priority"),
            "status": case.get("status"),
            "assignee": copy.deepcopy(case.get("assignee")),
            "reason_codes": copy.deepcopy(reasons[:3]),
            "explanation_available": bool((case.get("explanation") or {}).get("available")),
            "note_count": len(case.get("notes") or []),
            "resolution": copy.deepcopy(case.get("resolution")),
            "created_at": case.get("created_at"),
            "updated_at": case.get("updated_at"),
            "version": case.get("version"),
        }
