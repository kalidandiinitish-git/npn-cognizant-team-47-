"""API integration tests (PRD testing_strategy.integration_tests)."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from src.api import main
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


def test_dataset_info_reports_measured_values_not_placeholders(client, tmp_path, monkeypatch):
    """The route used to answer any failure with a hardcoded 42560-row file."""
    from src.api import main as api_main

    missing = tmp_path / "not_generated_yet.csv"
    monkeypatch.setattr(settings, "stream_data_path", missing)

    body = client.get("/api/dataset/info").json()
    assert body["stream_source"]["exists"] is False
    assert body["stream_source"]["rows"] == 0, "a missing file has no rows to report"

    # Once the file appears, the count must refresh rather than serve the
    # cached zero forever.
    missing.write_text("Time,Amount\n1,10.0\n2,20.0\n3,30.0\n", encoding="utf-8")
    refreshed = client.get("/api/dataset/info").json()
    assert refreshed["stream_source"]["exists"] is True
    assert refreshed["stream_source"]["rows"] == 3

    # And a rewrite of the same path is recounted, not served from cache.
    missing.write_text("Time,Amount\n1,10.0\n", encoding="utf-8")
    assert api_main._count_stream_rows(missing) == 1


def test_dataset_info_counts_rows_for_uploads(client, tmp_path, monkeypatch):
    """Uploads carried no row count, so the dashboard rendered every one as 0 rows."""
    from src.api import main as api_main

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    (upload_dir / "customer_batch.csv").write_text(
        "Time,Amount\n1,10.0\n2,20.0\n3,30.0\n4,40.0\n", encoding="utf-8"
    )
    monkeypatch.setattr(api_main, "UPLOAD_DIR", upload_dir)

    uploads = client.get("/api/dataset/info").json()["uploads"]
    assert len(uploads) == 1
    assert uploads[0]["name"] == "customer_batch.csv"
    assert uploads[0]["rows"] == 4, "an uploaded file reports the rows it actually has"


def test_high_risk_accounts_publish_the_weighting(client):
    """The dashboard renders these weights; a hardcoded copy silently goes stale."""
    from src.risk.scoring import ACCOUNT_RISK_WEIGHTS

    body = client.get("/api/accounts/high-risk").json()
    assert body["weights"] == ACCOUNT_RISK_WEIGHTS
    assert sum(body["weights"].values()) == pytest.approx(1.0)


def test_explicit_require_auth_without_credentials_fails_closed(client, monkeypatch):
    """REQUIRE_AUTH=true with no Supabase keys used to serve everything openly."""
    monkeypatch.setattr(settings, "require_auth", True)
    monkeypatch.setattr(settings, "require_auth_explicit", True)
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_anon_key", "")

    assert settings.auth_misconfigured is True

    protected = client.get("/api/metrics")
    assert protected.status_code == 503
    assert "REQUIRE_AUTH" in protected.json()["detail"]

    # Health stays public so the platform health check still reports, but it
    # must say the instance is degraded rather than claim everything is fine.
    health = client.get("/api/health").json()
    assert health["status"] == "degraded"
    assert "REQUIRE_AUTH" in health["detail"]


def test_unset_require_auth_stays_permissive_for_local_development(client, monkeypatch):
    """An unset flag is a developer who has not configured Supabase, not an
    operator asking for a locked-down service."""
    monkeypatch.setattr(settings, "require_auth", True)
    monkeypatch.setattr(settings, "require_auth_explicit", False)
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_anon_key", "")

    assert settings.auth_misconfigured is False
    assert client.get("/api/metrics").status_code == 200


def test_alert_status_update_requires_a_known_alert(client):
    response = client.patch("/api/alerts/TXN-does-not-exist", json={"status": "resolved"})
    assert response.status_code == 404
    assert client.patch("/api/alerts/TXN-1", json={"status": "bogus"}).status_code == 422


# ---------------------------------------------------------------------------
# CORS
#
# Vercel mints a new hostname for every project and every preview deployment
# (fraudstream-ai.vercel.app, fraudstream-ai-iota.vercel.app,
# npn-cognizant-team-47-seven.vercel.app, ...). An allow-list of exact origins
# therefore goes stale on a redeploy: the engine keeps answering 200, the
# browser drops the response for want of an Access-Control-Allow-Origin header,
# and services/api.js quietly serves fabricated transactions in its place. That
# failure is invisible from the server side, so it is pinned down here.
# ---------------------------------------------------------------------------

DASHBOARD_ORIGINS = [
    "https://fraudstream-ai.vercel.app",
    "https://fraudstream-ai-iota.vercel.app",
    "https://npn-cognizant-team-47-seven.vercel.app",
    "https://fraudstream-ai-git-main-team47.vercel.app",
    "https://npn-cognizant-team-47-9f3ka2x1-team47.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
]


@pytest.mark.parametrize("origin", DASHBOARD_ORIGINS)
def test_dashboard_origins_are_readable_by_the_browser(client, origin):
    response = client.get("/api/health", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize("origin", DASHBOARD_ORIGINS)
def test_dashboard_origins_survive_preflight(client, origin):
    response = client.options(
        "/api/metrics",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example.com",
        # A look-alike must not pass: matching must be anchored to the whole
        # host, not merely contained in it.
        "https://fraudstream-ai.vercel.app.evil.com",
        "https://not-fraudstream-ai.vercel.app",
    ],
)
def test_unrelated_origins_are_refused(client, origin):
    response = client.get("/api/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in response.headers


# ---------------------------------------------------------------------------
# Stream autostart
#
# The dashboard's numbers are counters in this process's memory and the free
# Render plan stops the instance after ~15 minutes idle, so every wake used to
# hand a visitor a healthy engine with an idle stream and nothing to show.
# ---------------------------------------------------------------------------

class _RecordingWriter:
    enabled = False

    def close(self):  # pragma: no cover - shutdown only touches this when enabled
        pass


class _RecordingProcessor:
    def __init__(self):
        self.started_with = None
        self.is_running = False
        # on_shutdown drains the processor, so the double has to answer it too.
        self.writer = _RecordingWriter()

    def start(self, **kwargs):
        self.started_with = kwargs
        return {"started": True}

    def stop(self):  # pragma: no cover - only reached if is_running is True
        self.is_running = False


def _boot_with_autostart(monkeypatch, enabled, processor):
    monkeypatch.setattr(settings, "stream_autostart", enabled)
    monkeypatch.setattr(main, "get_processor", lambda: processor)
    with TestClient(main.app) as booted:
        booted.get("/api/health")


def test_boot_starts_the_stream_so_a_woken_instance_serves_data(monkeypatch, model_required):
    processor = _RecordingProcessor()
    _boot_with_autostart(monkeypatch, True, processor)

    assert processor.started_with is not None, "a woken engine must restore its own stream"
    assert processor.started_with["delay_ms"] == settings.stream_delay_ms


def test_boot_leaves_the_stream_alone_when_autostart_is_off(monkeypatch, model_required):
    processor = _RecordingProcessor()
    _boot_with_autostart(monkeypatch, False, processor)

    assert processor.started_with is None


def test_a_failing_autostart_still_leaves_a_serving_engine(monkeypatch, model_required):
    """Losing the stream must cost the dashboard its data, not the engine its
    health endpoint — otherwise one bad CSV takes the whole demo down."""
    class _Exploding(_RecordingProcessor):
        def start(self, **kwargs):
            raise RuntimeError("stream source unreadable")

    monkeypatch.setattr(settings, "stream_autostart", True)
    monkeypatch.setattr(main, "get_processor", lambda: _Exploding())
    with TestClient(main.app) as booted:
        assert booted.get("/api/health").status_code == 200
