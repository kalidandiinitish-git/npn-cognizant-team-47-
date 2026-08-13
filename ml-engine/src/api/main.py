"""FastAPI application for the FraudStream AI detection engine.

Start it with:
    uvicorn src.api.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware

from .. import __version__
from ..config import (
    DATA_DIR,
    LATENCY_TARGET_MS,
    RISK_BANDS,
    UPLOAD_DIR,
    ensure_directories,
    settings,
)
from ..features.identity import derive_identity
from ..inference.predictor import ModelNotTrainedError, get_predictor
from ..investigations import InvestigationConflict, InvestigationNotFound
from ..risk.scoring import assess
from ..streaming.generator import (
    STREAM_EPOCH,
    TransactionEvent,
    count_transactions,
    _event_timestamp,
)
from ..streaming.index import load_index
from ..streaming.processor import get_processor
from .auth import AuthenticatedUser, require_user
from .schemas import (
    AlertStatusUpdate,
    HealthResponse,
    InvestigationAssignmentUpdate,
    InvestigationNoteCreate,
    InvestigationResolutionCreate,
    InvestigationStatusUpdate,
    PredictRequest,
    StreamStartRequest,
)

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 250 * 1024 * 1024  # 250 MB
SAFE_FILENAME = re.compile(r"^[A-Za-z0-9._-]+$")
STARTED_AT = time.time()

app = FastAPI(
    title="FraudStream AI Detection Engine",
    description=(
        "Generator based pseudo-streaming credit card fraud detection: real-time "
        "scoring, risk bands, account risk aggregation and stream control."
    ),
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "apikey"],
)

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Health (public)
# ---------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    """Liveness plus a readiness summary of the engine's dependencies."""
    model_loaded = False
    model_name: Optional[str] = None
    detail: Optional[str] = None
    try:
        predictor = get_predictor()
        model_loaded = True
        model_name = predictor.model_name
    except ModelNotTrainedError as error:
        detail = str(error)

    dataset = settings.resolve_dataset_path()
    return HealthResponse(
        status="ok" if model_loaded else "degraded",
        version=__version__,
        model_loaded=model_loaded,
        model_name=model_name,
        dataset_available=dataset is not None,
        stream_source_available=settings.stream_data_path.exists(),
        supabase_configured=settings.supabase_enabled,
        auth_required=settings.auth_enabled,
        detail=detail,
        engine_uptime_seconds=round(time.time() - STARTED_AT, 2),
    )


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------

@router.post("/predict", tags=["detection"])
def predict(
    payload: PredictRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    """Score a single transaction (PRD FR-009)."""
    try:
        predictor = get_predictor()
    except ModelNotTrainedError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error

    record = payload.as_record()
    provided = payload.provided_feature_count()

    if payload.update_account_risk:
        processor = get_processor()
        event = TransactionEvent(
            transaction_id=f"TXN-API-{uuid4().hex[:10].upper()}",
            sequence=0,
            event_time=record["Time"],
            transaction_time=_event_timestamp(record["Time"]),
            amount=record["Amount"],
            features=record,
            identity=derive_identity(record),
            ingested_at=datetime.now(timezone.utc).isoformat(),
            label=None,
        )
        row = processor.process_event(
            event, persist=False, create_investigation=False
        )
        return {
            **row,
            "feature_completeness": {"provided": provided, "expected": 28},
            "threshold": predictor.threshold,
            "model_name": predictor.model_name,
            "model_version": predictor.model_version,
        }

    result = predictor.predict(record)
    assessment = assess(result.probability, result.threshold)
    identity = derive_identity(record)
    return {
        "transaction_ref": f"TXN-API-{uuid4().hex[:10].upper()}",
        "transaction_time": _event_timestamp(record["Time"]),
        "transaction_amount": round(record["Amount"], 2),
        **identity,
        "model_score": assessment.probability,
        "risk_score": assessment.risk_score,
        "risk_level": assessment.risk_level,
        "decision": assessment.action,
        "is_fraud": assessment.alert_required,
        "inference_latency_ms": round(result.inference_latency_ms, 3),
        "threshold": result.threshold,
        "model_name": result.model_name,
        "model_version": result.model_version,
        "latency_target_ms": LATENCY_TARGET_MS,
        "feature_completeness": {"provided": provided, "expected": 28},
    }


# ---------------------------------------------------------------------------
# Stream control
# ---------------------------------------------------------------------------

@router.post("/stream/start", tags=["stream"])
def stream_start(
    payload: Optional[StreamStartRequest] = None,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    """Start the generator based pseudo-stream (PRD FR-008)."""
    request = payload or StreamStartRequest()
    processor = get_processor()
    try:
        result = processor.start(
            source=request.source,
            limit=request.limit,
            delay_ms=request.delay_ms,
            skip=request.skip,
            persist=request.persist,
            reset=request.reset,
        )
        if not result.get("started"):
            # Returning 200 for "did nothing" makes callers poll a stream they
            # did not start. 409 says exactly what happened.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=result.get("reason", "A stream is already running."),
            )
        return result
    except ModelNotTrainedError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error


@router.post("/stream/stop", tags=["stream"])
def stream_stop(user: AuthenticatedUser = Depends(require_user)) -> Dict[str, Any]:
    """Stop the active stream cleanly."""
    return get_processor().stop()


@router.get("/stream/status", tags=["stream"])
def stream_status(user: AuthenticatedUser = Depends(require_user)) -> Dict[str, Any]:
    return get_processor().status()


# ---------------------------------------------------------------------------
# Dashboard data
# ---------------------------------------------------------------------------

@router.get("/metrics", tags=["dashboard"])
def metrics(user: AuthenticatedUser = Depends(require_user)) -> Dict[str, Any]:
    """Everything the dashboard widgets need in one call."""
    return get_processor().metrics()


@router.get("/transactions/recent", tags=["dashboard"])
def recent_transactions(
    limit: int = Query(default=50, ge=1, le=500),
    risk_level: Optional[str] = Query(default=None),
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    rows = get_processor().recent_transactions(limit if risk_level is None else 500)
    if risk_level:
        rows = [row for row in rows if row.get("risk_level") == risk_level][:limit]
    return {"count": len(rows), "transactions": rows}


@router.get("/alerts", tags=["dashboard"])
def alerts(
    limit: int = Query(default=50, ge=1, le=500),
    risk_level: Optional[str] = Query(default=None, pattern="^(high|critical)$"),
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    """Recent fraud alerts (PRD FR-010)."""
    rows = get_processor().recent_alerts(limit=limit, level=risk_level)
    return {"count": len(rows), "alerts": rows}


@router.patch("/alerts/{transaction_id}", tags=["dashboard"])
def update_alert(
    transaction_id: str,
    payload: AlertStatusUpdate,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    """Move an alert through its triage states."""
    processor = get_processor()
    updated = processor.update_alert_status(
        transaction_id,
        payload.status,
        {"id": user.id, "email": user.email},
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Alert not found in the live buffer.")
    return {"updated": True, "alert": updated}


# ---------------------------------------------------------------------------
# Explainable investigations
# ---------------------------------------------------------------------------

@router.get("/investigations", tags=["investigations"])
def investigations(
    status_filter: Optional[str] = Query(
        default=None,
        alias="status",
        pattern="^(open|investigating|resolved|dismissed)$",
    ),
    risk_level: Optional[str] = Query(default=None, pattern="^(high|critical)$"),
    assignee_id: Optional[str] = Query(default=None),
    unassigned: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    """List fraud cases using workflow-oriented filters."""
    return get_processor().investigations.list_cases(
        status=status_filter,
        risk_level=risk_level,
        assignee_id=assignee_id,
        unassigned=unassigned,
        limit=limit,
        offset=offset,
    )


@router.get("/investigations/metrics", tags=["investigations"])
def investigation_metrics(
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    return get_processor().investigations.metrics()


@router.get("/investigations/{case_id}", tags=["investigations"])
def investigation_detail(
    case_id: str,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    try:
        return {"case": get_processor().investigations.get(case_id)}
    except InvestigationNotFound as error:
        raise HTTPException(status_code=404, detail="Investigation case not found.") from error


@router.patch("/investigations/{case_id}/assignment", tags=["investigations"])
def assign_investigation(
    case_id: str,
    payload: InvestigationAssignmentUpdate,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    processor = get_processor()
    actor = {"id": user.id, "email": user.email}
    try:
        case = processor.investigations.assign(
            case_id,
            payload.assignee_id,
            payload.assignee_email,
            actor,
            payload.expected_version,
        )
    except InvestigationNotFound as error:
        raise HTTPException(status_code=404, detail="Investigation case not found.") from error
    except InvestigationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    processor.persist_investigation(case)
    return {"updated": True, "case": case}


@router.post("/investigations/{case_id}/notes", tags=["investigations"])
def add_investigation_note(
    case_id: str,
    payload: InvestigationNoteCreate,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    processor = get_processor()
    actor = {"id": user.id, "email": user.email}
    try:
        result = processor.investigations.add_note(
            case_id, payload.body, actor, payload.expected_version
        )
    except InvestigationNotFound as error:
        raise HTTPException(status_code=404, detail="Investigation case not found.") from error
    except InvestigationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    note = result.pop("created_note")
    processor.persist_investigation(result, note=note)
    return {"created": True, "note": note, "case": result}


@router.patch("/investigations/{case_id}/status", tags=["investigations"])
def update_investigation_status(
    case_id: str,
    payload: InvestigationStatusUpdate,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    processor = get_processor()
    actor = {"id": user.id, "email": user.email}
    try:
        case = processor.investigations.set_status(
            case_id, payload.status, actor, payload.expected_version
        )
    except InvestigationNotFound as error:
        raise HTTPException(status_code=404, detail="Investigation case not found.") from error
    except InvestigationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    processor.state.update_alert_status(
        transaction_id=case["transaction_id"], status=case["status"]
    )
    if processor.writer.enabled:
        processor.writer.update_alert_status(case["transaction_id"], case["status"])
    processor.persist_investigation(case)
    return {"updated": True, "case": case}


@router.post("/investigations/{case_id}/resolution", tags=["investigations"])
def resolve_investigation(
    case_id: str,
    payload: InvestigationResolutionCreate,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    processor = get_processor()
    actor = {"id": user.id, "email": user.email}
    try:
        case = processor.investigations.resolve(
            case_id,
            payload.code,
            payload.summary,
            payload.confidence,
            actor,
            payload.expected_version,
        )
    except InvestigationNotFound as error:
        raise HTTPException(status_code=404, detail="Investigation case not found.") from error
    except InvestigationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    processor.state.update_alert_status(
        transaction_id=case["transaction_id"], status=case["status"]
    )
    if processor.writer.enabled:
        processor.writer.update_alert_status(case["transaction_id"], case["status"])
    processor.persist_investigation(case)
    return {"resolved": True, "case": case}


@router.get("/accounts/high-risk", tags=["dashboard"])
def high_risk_accounts(
    minimum_level: str = Query(default="high", pattern="^(low|medium|high|critical)$"),
    limit: int = Query(default=50, ge=1, le=200),
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    """Accounts whose aggregated behaviour is risky (PRD FR-011)."""
    rows = get_processor().high_risk_accounts(minimum_level=minimum_level, limit=limit)
    return {"count": len(rows), "accounts": rows}


@router.get("/accounts/{account_id}", tags=["dashboard"])
def account_detail(
    account_id: str,
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    processor = get_processor()
    profiles = {profile.account_id: profile for profile in processor.accounts.all_profiles()}
    profile = profiles.get(account_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Account has not been seen in this stream.")
    transactions = [
        row
        for row in processor.state.recent_transactions(limit=500)
        if row.get("account_id") == account_id
    ][:50]
    return {
        **profile.as_dict(),
        "signals": processor.accounts.signal_breakdown(account_id),
        "transactions": transactions,
    }


# ---------------------------------------------------------------------------
# Model and dataset
# ---------------------------------------------------------------------------

@router.get("/model", tags=["model"])
def model_details(user: AuthenticatedUser = Depends(require_user)) -> Dict[str, Any]:
    """Full training report for the Model Analytics page."""
    try:
        predictor = get_predictor()
    except ModelNotTrainedError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    metadata = dict(predictor.metadata)
    metadata["live_quality"] = get_processor().state.live_quality()
    metadata["risk_bands"] = metadata.get("risk_bands") or [
        {
            "level": band.level,
            "lower": band.lower,
            "upper": min(band.upper, 1.0),
            "action": band.action,
        }
        for band in RISK_BANDS
    ]
    return metadata


@router.get("/dataset/info", tags=["dataset"])
def dataset_info(user: AuthenticatedUser = Depends(require_user)) -> Dict[str, Any]:
    """Active dataset, held-out stream file and the EDA profile (PRD FR-001)."""
    dataset = settings.resolve_dataset_path()
    profile_path = DATA_DIR / "dataset_profile.json"
    profile: Optional[Dict[str, Any]] = None
    if profile_path.exists():
        try:
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            profile = None

    stream_path = settings.stream_data_path
    stream_rows = count_transactions(stream_path) if stream_path.exists() else 0
    fraud_index = load_index()

    uploads: List[Dict[str, Any]] = []
    if UPLOAD_DIR.exists():
        for item in sorted(UPLOAD_DIR.glob("*.csv")):
            uploads.append(
                {
                    "name": item.name,
                    "size_bytes": item.stat().st_size,
                    "modified_at": datetime.fromtimestamp(
                        item.stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                }
            )

    return {
        "training_dataset": {
            "path": str(dataset) if dataset else None,
            "name": dataset.name if dataset else None,
            "exists": dataset is not None,
            "size_bytes": dataset.stat().st_size if dataset else 0,
        },
        "stream_source": {
            "path": str(stream_path),
            "name": stream_path.name,
            "exists": stream_path.exists(),
            "rows": stream_rows,
            "size_bytes": stream_path.stat().st_size if stream_path.exists() else 0,
        },
        "stream_epoch": STREAM_EPOCH.isoformat(),
        "uploads": uploads,
        "profile": profile,
        "fraud_index": fraud_index,
    }


@router.post("/dataset/upload", tags=["dataset"])
async def upload_dataset(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_user),
) -> Dict[str, Any]:
    """Upload a historical transaction CSV (PRD FR-001).

    The file is stored under ml-engine/data/uploads. Pass its name as the
    ``source`` when starting a stream, or point DATA_PATH at it before training.
    """
    ensure_directories()
    original = Path(file.filename or "").name
    if not original.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted.")
    safe_name = original.replace(" ", "_")
    if not SAFE_FILENAME.match(safe_name):
        raise HTTPException(
            status_code=400,
            detail="File name may only contain letters, digits, dot, underscore and hyphen.",
        )

    destination = UPLOAD_DIR / safe_name
    written = 0
    try:
        with destination.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    handle.close()
                    destination.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                handle.write(chunk)
    finally:
        await file.close()

    rows = count_transactions(destination)
    logger.info("Stored uploaded dataset %s (%s rows)", destination, rows)
    return {
        "stored": True,
        "name": safe_name,
        "path": str(destination),
        "size_bytes": written,
        "rows": rows,
        "usage": "Pass this file name as 'source' to POST /api/stream/start.",
    }


app.include_router(router)


@app.get("/", tags=["system"])
def root() -> Dict[str, str]:
    return {
        "service": "FraudStream AI Detection Engine",
        "version": __version__,
        "docs": "/docs",
        "health": "/api/health",
    }


@app.on_event("startup")
def on_startup() -> None:
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    ensure_directories()
    logger.info("FraudStream AI engine %s starting", __version__)
    logger.info("CORS origins: %s", settings.cors_origins)
    if not settings.auth_enabled:
        logger.warning("Authentication is NOT enforced on this instance.")
    try:
        predictor = get_predictor()
        logger.info(
            "Model ready: %s v%s threshold=%.4f",
            predictor.model_name,
            predictor.model_version,
            predictor.threshold,
        )
    except ModelNotTrainedError as error:
        logger.warning("Model not loaded: %s", error)


@app.on_event("shutdown")
def on_shutdown() -> None:
    processor = get_processor()
    if processor.is_running:
        processor.stop()
    if processor.writer.enabled:
        processor.writer.close()
    logger.info("FraudStream AI engine stopped")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )
