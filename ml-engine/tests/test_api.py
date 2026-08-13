"""API integration tests (PRD testing_strategy.integration_tests)."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from src.api.main import app
from src.config import PCA_FEATURES, settings
from src.streaming.processor import get_processor


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    processor = get_processor()
    if processor.is_running:
        processor.stop()


@pytest.fixture
def model_required():
    if not (settings.model_path.exists() and settings.preprocessor_path.exists()):
        pytest.skip("Model artifacts are missing; run python -m src.training.train first.")


def sample_payload(amount: float = 149.62) -> dict:
    payload = {name: 0.1 for name in PCA_FEATURES}
    payload.update({"Time": 3600, "Amount": amount})
    return payload


def test_health_is_public_and_reports_readiness(client):
    response = client.get("/api/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] in {"ok", "degraded"}
    assert set(body) >= {
        "version",
        "model_loaded",
        "dataset_available",
        "stream_source_available",
        "supabase_configured",
        "auth_required",
    }


def test_root_lists_entry_points(client):
    body = client.get("/").json()
    assert body["health"] == "/api/health"


def test_openapi_exposes_every_prd_endpoint(client):
    paths = client.get("/openapi.json").json()["paths"]
    for path in (
        "/api/health",
        "/api/predict",
        "/api/stream/start",
        "/api/stream/stop",
        "/api/stream/status",
        "/api/metrics",
        "/api/alerts",
        "/api/accounts/high-risk",
    ):
        assert path in paths, f"{path} is required by the PRD"


def test_predict_returns_a_scored_transaction(client, model_required):
    response = client.post("/api/predict", json=sample_payload())
    assert response.status_code == 200

    body = response.json()
    assert 0.0 <= body["model_score"] <= 1.0
    assert 0.0 <= body["risk_score"] <= 1.0
    assert body["risk_level"] in {"low", "medium", "high", "critical"}
    assert body["decision"] in {"Allow", "Monitor", "Flag", "Alert and investigate"}
    assert body["inference_latency_ms"] < body["latency_target_ms"]
    assert body["account_id"].startswith("ACC-")
    assert body["feature_completeness"] == {"provided": 28, "expected": 28}


def test_predict_rejects_invalid_payloads(client):
    assert client.post("/api/predict", json={}).status_code == 422
    assert client.post("/api/predict", json={"Amount": -1}).status_code == 422
    assert client.post("/api/predict", json={"Amount": "abc"}).status_code == 422


def test_stream_lifecycle_and_metrics(client, model_required):
    if not settings.stream_data_path.exists():
        pytest.skip("Held-out stream file is missing; run training to generate it.")

    client.post("/api/stream/stop")
    start = client.post(
        "/api/stream/start", json={"limit": 25, "delay_ms": 0, "persist": False, "reset": True}
    )
    assert start.status_code == 200
    assert start.json()["started"] is True

    deadline = time.time() + 30
    while time.time() < deadline:
        status = client.get("/api/stream/status").json()
        if status["processed"] >= 25 or not status["is_running"]:
            break
        time.sleep(0.3)

    stop = client.post("/api/stream/stop")
    assert stop.status_code == 200

    metrics = client.get("/api/metrics").json()
    assert metrics["totals"]["total_transactions"] > 0
    assert metrics["latency"]["average_ms"] is not None
    assert metrics["latency"]["average_ms"] < metrics["latency"]["target_ms"]

    transactions = client.get("/api/transactions/recent?limit=10").json()
    assert transactions["count"] > 0
    assert transactions["transactions"][0]["risk_level"] in {
        "low",
        "medium",
        "high",
        "critical",
    }

    alerts = client.get("/api/alerts?limit=10").json()
    assert "alerts" in alerts

    accounts = client.get("/api/accounts/high-risk?minimum_level=low&limit=5").json()
    assert accounts["count"] >= 1
    assert accounts["accounts"][0]["account_id"].startswith("ACC-")


def test_stream_rejects_bad_parameters(client):
    assert client.post("/api/stream/start", json={"limit": 0}).status_code == 422
    assert client.post("/api/stream/start", json={"delay_ms": -5}).status_code == 422
    assert client.post("/api/stream/start", json={"unknown": 1}).status_code == 422
    assert (
        client.post("/api/stream/start", json={"source": "does-not-exist.csv"}).status_code == 400
    )


@pytest.mark.parametrize(
    "source",
    [
        "../creditcard.csv",
        "..\\..\\windows\\system32\\drivers\\etc\\hosts",
        "/etc/passwd",
        "C:\\Windows\\win.ini",
        "uploads/../../secrets.csv",
        "notes.txt",
    ],
)
def test_stream_source_rejects_paths_and_non_csv(client, source):
    """A request must not be able to stream arbitrary files off the host."""
    response = client.post("/api/stream/start", json={"source": source})
    assert response.status_code == 422, f"{source} should have been rejected"


def test_uploaded_files_are_resolvable_by_name(tmp_path):
    """An uploaded CSV is found by bare name, not just files in data/."""
    from src.config import UPLOAD_DIR, ensure_directories
    from src.streaming.processor import StreamProcessor

    ensure_directories()
    name = "resolve_probe.csv"
    target = UPLOAD_DIR / name
    target.write_text("Time,Amount\n0,1.0\n", encoding="utf-8")
    try:
        processor = StreamProcessor()
        assert processor.resolve_source(name) == target
    finally:
        target.unlink(missing_ok=True)


def test_model_endpoint_exposes_evaluation_report(client, model_required):
    body = client.get("/api/model").json()
    assert body["model_name"]
    assert body["metrics"]["test"]["pr_auc"] is not None
    assert body["latency"]["average_ms"] < body["latency"]["target_ms"]
    assert len(body["risk_bands"]) == 4


def test_dataset_info_reports_the_source(client):
    body = client.get("/api/dataset/info").json()
    assert "training_dataset" in body
    assert "stream_source" in body
    if body["training_dataset"]["exists"]:
        assert body["training_dataset"]["name"].endswith(".csv")


def test_alert_status_update_requires_a_known_alert(client):
    response = client.patch("/api/alerts/TXN-does-not-exist", json={"status": "resolved"})
    assert response.status_code == 404
    assert client.patch("/api/alerts/TXN-1", json={"status": "bogus"}).status_code == 422
