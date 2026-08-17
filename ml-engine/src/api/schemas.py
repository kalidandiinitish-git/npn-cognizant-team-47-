"""Request and response models for the API."""

from __future__ import annotations

import re
from pathlib import PurePosixPath
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..config import PCA_FEATURES

#: One path segment of a stream source. Deliberately the same character set the
#: upload endpoint accepts for a file name, so anything the engine can store is
#: something the engine can be asked to stream.
SAFE_SOURCE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")


class PredictRequest(BaseModel):
    """One transaction to score.

    Extra keys are allowed so the 28 PCA components (V1..V28) can be sent
    alongside Time and Amount without declaring 28 explicit fields.
    """

    model_config = ConfigDict(extra="allow", protected_namespaces=())

    Time: float = Field(default=0.0, ge=0, description="Seconds since the first transaction.")
    Amount: float = Field(..., ge=0, description="Transaction amount.")
    update_account_risk: bool = Field(
        default=False,
        description="Fold this transaction into the account risk profile as well.",
    )

    def as_record(self) -> Dict[str, float]:
        payload = self.model_dump(exclude={"update_account_risk"})
        record: Dict[str, float] = {"Time": float(payload.get("Time", 0.0)),
                                    "Amount": float(payload.get("Amount", 0.0))}
        for name in PCA_FEATURES:
            value = payload.get(name)
            if value is not None:
                try:
                    record[name] = float(value)
                except (TypeError, ValueError):
                    continue
        return record

    def provided_feature_count(self) -> int:
        payload = self.model_dump(exclude={"update_account_risk"})
        return sum(1 for name in PCA_FEATURES if payload.get(name) is not None)


class StreamStartRequest(BaseModel):
    """Parameters for a pseudo-stream run."""

    model_config = ConfigDict(extra="forbid")

    source: Optional[str] = Field(
        default=None,
        description=(
            "A CSV in ml-engine/data by bare name, or an upload as "
            "'<owner>/<file>.csv' as reported by GET /api/dataset/info. "
            "Defaults to the held-out test split."
        ),
        max_length=255,
    )

    @field_validator("source")
    @classmethod
    def source_must_stay_inside_the_data_directories(
        cls, value: Optional[str]
    ) -> Optional[str]:
        """Allow at most one owner directory, and nothing that walks upwards.

        Uploads are namespaced by uploader, so a source has to be able to name
        the owner as well as the file. That is the *only* directory component
        permitted: without this restriction `source` could name any readable CSV
        on the host and stream its contents into the dashboard. Operators who
        need a path outside the data directory should set DATA_PATH or
        STREAM_DATA_PATH instead.
        """
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            return None
        # Normalise separators first: a backslash is a directory separator on the
        # host this may run on, so validating the raw string would let
        # "..\\secrets.csv" through as an innocent-looking bare name.
        normalised = candidate.replace("\\", "/")
        parts = PurePosixPath(normalised).parts
        if normalised.startswith("/") or len(parts) > 2:
            raise ValueError(
                "source must be a file name, optionally prefixed by one owner "
                "directory, and must not be an absolute path."
            )
        if any(part in {"..", "."} for part in parts):
            raise ValueError("source must not contain '..' or '.' segments.")
        if not SAFE_SOURCE_SEGMENT.match(parts[0]):
            raise ValueError(
                "source segments may only contain letters, digits, dot, "
                "underscore and hyphen."
            )
        if len(parts) == 2 and not SAFE_SOURCE_SEGMENT.match(parts[1]):
            raise ValueError(
                "source segments may only contain letters, digits, dot, "
                "underscore and hyphen."
            )
        if not normalised.lower().endswith(".csv"):
            raise ValueError("source must be a .csv file.")
        return normalised
    limit: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    delay_ms: Optional[int] = Field(
        default=None, ge=0, le=10_000, description="Pause between transactions."
    )
    skip: int = Field(default=0, ge=0)
    persist: bool = Field(default=True, description="Write results to Supabase.")
    reset: bool = Field(default=True, description="Clear counters before starting.")


class AlertStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(..., pattern="^(open|investigating|resolved|dismissed)$")


class InvestigationAssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignee_id: Optional[str] = Field(default=None, max_length=128)
    assignee_email: Optional[str] = Field(default=None, max_length=320)
    expected_version: Optional[int] = Field(default=None, ge=1)


class InvestigationNoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(..., min_length=1, max_length=4_000)
    expected_version: Optional[int] = Field(default=None, ge=1)

    @field_validator("body")
    @classmethod
    def note_must_contain_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Note cannot be blank.")
        return cleaned


class InvestigationStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(..., pattern="^(open|investigating|resolved|dismissed)$")
    expected_version: Optional[int] = Field(default=None, ge=1)


class InvestigationResolutionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(
        ...,
        pattern="^(confirmed_fraud|legitimate|false_positive|duplicate|insufficient_evidence|other)$",
    )
    summary: str = Field(..., min_length=1, max_length=2_000)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    expected_version: Optional[int] = Field(default=None, ge=1)

    @field_validator("summary")
    @classmethod
    def summary_must_contain_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Resolution summary cannot be blank.")
        return cleaned


class HealthResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    status: str
    version: str
    model_loaded: bool
    model_name: Optional[str] = None
    dataset_available: bool
    stream_source_available: bool
    supabase_configured: bool
    auth_required: bool
    detail: Optional[str] = None
    engine_uptime_seconds: float = 0.0
