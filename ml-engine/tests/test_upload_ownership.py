"""Uploads are owned by the account that uploaded them.

The engine is a single shared workspace on purpose: a fraud team works one alert
queue, so every analyst sees every transaction. What was never intentional is
that two analysts uploading ``transactions.csv`` wrote to the same path, so the
second upload silently destroyed the first, and that a stream someone else
started looked identical to one you started yourself.

These tests pin the two things that fix: uploads are namespaced by uploader and
carry their attribution, and a run records who started it.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api.auth import AuthenticatedUser, require_user
from src.api.main import app
from src.config import PCA_FEATURES


def ulb_csv(rows: int = 4, labelled: bool = True) -> bytes:
    """A CSV in the schema the model reads, as raw upload bytes."""
    buffer = io.StringIO()
    fieldnames = ["Time"] + list(PCA_FEATURES) + ["Amount"] + (["Class"] if labelled else [])
    writer = csv.DictWriter(buffer, fieldnames=fieldnames)
    writer.writeheader()
    for index in range(rows):
        row = {"Time": index * 7, "Amount": f"{10.0 + index:.2f}"}
        row.update({name: "0.1" for name in PCA_FEATURES})
        if labelled:
            row["Class"] = "0"
        writer.writerow(row)
    return buffer.getvalue().encode("utf-8")


ANALYST_A = AuthenticatedUser(id="11111111-1111-4111-8111-111111111111", email="ada@bank.test", role="analyst")
ANALYST_B = AuthenticatedUser(id="22222222-2222-4222-8222-222222222222", email="bo@bank.test", role="analyst")


@pytest.fixture
def upload_root(tmp_path, monkeypatch) -> Path:
    """Point the API's uploads directory at a throwaway tree."""
    from src.api import main as api_main
    from src.streaming import processor as processor_module

    root = tmp_path / "uploads"
    root.mkdir()
    monkeypatch.setattr(api_main, "UPLOAD_DIR", root)
    monkeypatch.setattr(processor_module, "UPLOAD_DIR", root)
    return root


@pytest.fixture
def client(upload_root):
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(require_user, None)


def sign_in_as(user: AuthenticatedUser) -> None:
    app.dependency_overrides[require_user] = lambda: user


def upload_as(client: TestClient, user: AuthenticatedUser, name: str, rows: int = 4):
    sign_in_as(user)
    return client.post(
        "/api/dataset/upload",
        files={"file": (name, ulb_csv(rows=rows), "text/csv")},
    )


# ---------------------------------------------------------------------------
# Namespacing
# ---------------------------------------------------------------------------

def test_two_accounts_can_upload_the_same_file_name(client, upload_root):
    """The overwrite bug: identical names used to collide on one path."""
    first = upload_as(client, ANALYST_A, "transactions.csv", rows=4)
    second = upload_as(client, ANALYST_B, "transactions.csv", rows=9)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    stored = sorted(path for path in upload_root.rglob("*.csv"))
    assert len(stored) == 2, "one upload overwrote the other"
    assert first.json()["source"] != second.json()["source"]

    sign_in_as(ANALYST_A)
    uploads = client.get("/api/dataset/info").json()["uploads"]
    by_source = {item["source"]: item for item in uploads}
    assert len(by_source) == 2
    # The row counts prove neither file was truncated by the other's write.
    assert sorted(item["rows"] for item in uploads) == [4, 9]


def test_upload_records_who_uploaded_it(client):
    upload_as(client, ANALYST_A, "ada_batch.csv")

    sign_in_as(ANALYST_B)
    uploads = client.get("/api/dataset/info").json()["uploads"]
    entry = next(item for item in uploads if item["name"] == "ada_batch.csv")

    assert entry["owner_email"] == ANALYST_A.email
    assert entry["owner_id"] == ANALYST_A.id
    assert entry["mine"] is False, "Bo did not upload this file"
    assert entry["uploaded_at"], "the listing has to say when it arrived"


def test_uploads_stay_visible_to_everyone(client):
    """Shared visibility is the intended model; only attribution was missing."""
    upload_as(client, ANALYST_A, "shared_view.csv")

    sign_in_as(ANALYST_B)
    uploads = client.get("/api/dataset/info").json()["uploads"]
    assert any(item["name"] == "shared_view.csv" for item in uploads)


def test_reuploading_your_own_file_replaces_it(client, upload_root):
    upload_as(client, ANALYST_A, "revision.csv", rows=4)
    second = upload_as(client, ANALYST_A, "revision.csv", rows=11)

    assert second.status_code == 200
    sign_in_as(ANALYST_A)
    uploads = [
        item for item in client.get("/api/dataset/info").json()["uploads"]
        if item["name"] == "revision.csv"
    ]
    assert len(uploads) == 1, "your own re-upload replaces, it does not duplicate"
    assert uploads[0]["rows"] == 11
    assert uploads[0]["mine"] is True


def test_uploads_made_before_namespacing_are_still_listed(client, upload_root):
    """Files already sitting at the root of data/uploads must not vanish."""
    (upload_root / "legacy_batch.csv").write_bytes(ulb_csv(rows=6))

    sign_in_as(ANALYST_A)
    uploads = client.get("/api/dataset/info").json()["uploads"]
    entry = next(item for item in uploads if item["name"] == "legacy_batch.csv")

    assert entry["rows"] == 6
    assert entry["owner_email"] is None, "there is no record of who uploaded it"
    assert entry["mine"] is False
    assert entry["source"] == "legacy_batch.csv", "streamable by its bare name"


# ---------------------------------------------------------------------------
# Streaming an owned upload
# ---------------------------------------------------------------------------

def test_an_owned_upload_is_streamable_by_its_reference(client, upload_root):
    from src.streaming.processor import StreamProcessor

    response = upload_as(client, ANALYST_A, "streamable.csv")
    reference = response.json()["source"]
    assert "/" in reference, "an owned upload is addressed under its owner"

    resolved = StreamProcessor().resolve_source(reference)
    assert resolved.exists()
    assert resolved.name == "streamable.csv"


def test_stream_status_addresses_the_live_upload_the_way_the_listing_does(
    client, model_required
):
    """The dashboard badges the streaming file by matching these two strings."""
    reference = upload_as(client, ANALYST_A, "badge_probe.csv", rows=5).json()["source"]

    client.post("/api/stream/stop")
    started = client.post(
        "/api/stream/start",
        json={"source": reference, "delay_ms": 0, "persist": False},
    )
    assert started.status_code == 200, started.text
    try:
        body = client.get("/api/stream/status").json()
        assert body["source_ref"] == reference
        assert body["source_name"] == "badge_probe.csv"
    finally:
        client.post("/api/stream/stop")


@pytest.mark.parametrize(
    "source",
    [
        "../creditcard.csv",
        "owner/../../secrets.csv",
        "a/b/deep.csv",
        "/etc/passwd",
        "owner/..%2fsecrets.csv",
        "..\\owner\\secrets.csv",
    ],
)
def test_stream_source_still_refuses_to_walk_the_filesystem(client, source):
    """Allowing one directory level must not reopen path traversal."""
    sign_in_as(ANALYST_A)
    response = client.post("/api/stream/start", json={"source": source})
    assert response.status_code == 422, f"{source} should have been rejected"


def test_resolve_source_refuses_a_reference_that_escapes_the_upload_root(upload_root):
    """Defence in depth: the schema is not the only thing guarding the root."""
    from src.streaming.processor import StreamProcessor

    outside = upload_root.parent / "outside.csv"
    outside.write_bytes(ulb_csv(rows=2))

    with pytest.raises(FileNotFoundError):
        StreamProcessor().resolve_source("../outside.csv")


# ---------------------------------------------------------------------------
# Stream attribution
# ---------------------------------------------------------------------------

def test_stream_status_names_the_account_that_started_the_run(client, model_required):
    sign_in_as(ANALYST_B)
    client.post("/api/stream/stop")
    started = client.post(
        "/api/stream/start", json={"limit": 5, "delay_ms": 0, "persist": False}
    )
    assert started.status_code == 200, started.text

    try:
        body = client.get("/api/stream/status").json()
        assert body["started_by"]["email"] == ANALYST_B.email
        assert body["started_by"]["id"] == ANALYST_B.id
    finally:
        client.post("/api/stream/stop")


def test_an_autostarted_run_is_attributed_to_the_engine(model_required):
    """Boot-time autostart has no user, and must not claim one."""
    from src.streaming.processor import StreamProcessor

    processor = StreamProcessor()
    processor.start(limit=2, delay_ms=0, persist=False)
    try:
        assert processor.status()["started_by"] is None
    finally:
        processor.stop()


# ---------------------------------------------------------------------------
# Enforcement
#
# The dashboard has always signed users in against Supabase, but the deployed
# engine ran with REQUIRE_AUTH=false, so it accepted every request that reached
# it and the login was decorative. These pin the gate itself, without the
# dependency override the tests above use to impersonate an account.
# ---------------------------------------------------------------------------

@pytest.fixture
def enforcing_auth(monkeypatch):
    """An engine configured the way the deployed one now is."""
    from src.api import auth as auth_module
    from src.config import settings

    app.dependency_overrides.pop(require_user, None)
    monkeypatch.setattr(settings, "require_auth", True)
    monkeypatch.setattr(settings, "require_auth_explicit", True)
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "anon-key")
    monkeypatch.setattr(auth_module, "_cache", {})
    return settings


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/dataset/info"),
        ("get", "/api/stream/status"),
        ("post", "/api/stream/start"),
        ("get", "/api/metrics"),
    ],
)
def test_protected_routes_refuse_an_unauthenticated_caller(
    client, enforcing_auth, method, path
):
    response = getattr(client, method)(path)
    assert response.status_code == 401, f"{path} served an anonymous caller"


def test_upload_refuses_an_unauthenticated_caller(client, enforcing_auth, upload_root):
    response = client.post(
        "/api/dataset/upload",
        files={"file": ("anon.csv", ulb_csv(rows=2), "text/csv")},
    )
    assert response.status_code == 401
    assert not list(upload_root.rglob("*.csv")), "an anonymous upload was stored"


def test_health_stays_public_so_the_keepalive_still_works(client, enforcing_auth):
    """.github/workflows/keepalive.yml polls this with no credentials."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["auth_required"] is True


def test_demanding_auth_without_credentials_fails_closed(client, monkeypatch):
    """A forgotten Render env var must not silently reopen the engine."""
    from src.config import settings

    app.dependency_overrides.pop(require_user, None)
    monkeypatch.setattr(settings, "require_auth", True)
    monkeypatch.setattr(settings, "require_auth_explicit", True)
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_anon_key", "")

    assert client.get("/api/dataset/info").status_code == 503
    health = client.get("/api/health").json()
    assert health["status"] == "degraded"
    assert "REQUIRE_AUTH" in health["detail"]


@pytest.fixture
def model_required():
    from src.config import settings

    if not (settings.model_path.exists() and settings.preprocessor_path.exists()):
        pytest.skip("Model artifacts are missing; run python -m src.training.train first.")
