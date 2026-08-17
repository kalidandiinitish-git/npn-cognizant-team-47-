"""End-to-end smoke test against a real HTTP server.

Starts uvicorn, waits for readiness, streams a batch of transactions through the
generator, then checks every dashboard endpoint. Used locally and as the
production smoke test from PRD phase 8.

    python scripts/smoke_e2e.py                 # start a server on port 8099
    python scripts/smoke_e2e.py --base-url https://engine.example.com --no-spawn
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT))

PASS = "PASS"
FAIL = "FAIL"


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.rows.append((PASS if ok else FAIL, name, detail))
        print(f"[{PASS if ok else FAIL}] {name}" + (f" - {detail}" if detail else ""))

    @property
    def failed(self) -> int:
        return sum(1 for status, _, _ in self.rows if status == FAIL)

    def summary(self) -> str:
        total = len(self.rows)
        return f"{total - self.failed}/{total} checks passed"


def wait_for_health(client: httpx.Client, timeout: float = 60.0) -> Optional[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            response = client.get("/api/health", timeout=5.0)
            if response.status_code == 200:
                return response.json()
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    return None


def run_checks(base_url: str, token: Optional[str], limit: int) -> Report:
    report = Report()
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    with httpx.Client(base_url=base_url, headers=headers, timeout=30.0) as client:
        health = wait_for_health(client)
        report.add("engine responds on /api/health", health is not None)
        if health is None:
            return report

        report.add(
            "model artifacts loaded",
            bool(health.get("model_loaded")),
            str(health.get("model_name") or health.get("detail")),
        )
        report.add("stream source present", bool(health.get("stream_source_available")))

        if not health.get("model_loaded"):
            report.add("remaining checks skipped", False, "train the model first")
            return report

        # --- single prediction ---
        payload = {f"V{index}": 0.1 for index in range(1, 29)}
        payload.update({"Time": 3600, "Amount": 149.62})
        prediction = client.post("/api/predict", json=payload)
        report.add("POST /api/predict returns 200", prediction.status_code == 200)
        if prediction.status_code == 200:
            body = prediction.json()
            report.add(
                "prediction has a risk band and latency",
                body["risk_level"] in {"low", "medium", "high", "critical"}
                and body["inference_latency_ms"] > 0,
                f"score={body['risk_score']} level={body['risk_level']} "
                f"latency={body['inference_latency_ms']}ms",
            )
            report.add(
                "latency inside the target",
                body["inference_latency_ms"] < body["latency_target_ms"],
                f"{body['inference_latency_ms']}ms < {body['latency_target_ms']}ms",
            )

        # --- stream lifecycle ---
        # Start near labelled fraud so alerting and account escalation are
        # actually exercised. Fraud is 0.12 % of the split, so a run from row
        # zero would almost certainly flag nothing.
        dataset_info = client.get("/api/dataset/info").json()
        fraud_index = dataset_info.get("fraud_index") or {}
        skip = int(fraud_index.get("recommended_skip") or 0)
        report.add(
            "stream file indexed for labelled fraud",
            bool(fraud_index),
            f"{fraud_index.get('fraud_count')} frauds, first at row "
            f"{fraud_index.get('first_fraud_row')}"
            if fraud_index
            else "run python -m src.streaming.index",
        )

        # Clear anything left running from a previous session.
        client.post("/api/stream/stop")

        start = client.post(
            "/api/stream/start",
            json={"limit": limit, "delay_ms": 0, "skip": skip, "persist": True, "reset": True},
        )
        report.add(
            "POST /api/stream/start returns 200",
            start.status_code == 200,
            "" if start.status_code == 200 else start.text[:120],
        )

        # A second concurrent stream must be refused, not silently ignored.
        conflict = client.post("/api/stream/start", json={"limit": 10})
        report.add(
            "concurrent stream start is refused with 409",
            conflict.status_code == 409,
            f"status={conflict.status_code}",
        )

        processed = 0
        deadline = time.time() + 120
        while time.time() < deadline:
            status = client.get("/api/stream/status").json()
            processed = status["processed"]
            if processed >= limit or not status["is_running"]:
                break
            time.sleep(0.4)
        report.add(
            f"generator processed {limit} transactions",
            processed >= limit,
            f"processed={processed}",
        )

        client.post("/api/stream/stop")
        stopped = client.get("/api/stream/status").json()
        report.add("stream stops cleanly", stopped["is_running"] is False, stopped["status"])

        # --- dashboard endpoints ---
        metrics = client.get("/api/metrics").json()
        totals = metrics["totals"]
        latency = metrics["latency"]
        report.add(
            "GET /api/metrics reports totals",
            totals["total_transactions"] >= limit,
            f"{totals['total_transactions']} transactions, "
            f"{totals['fraud_transactions']} flagged, "
            f"{totals['high_risk_accounts']} high-risk accounts",
        )
        report.add(
            "measured latency beats the 50 ms budget",
            bool(latency["within_target"]),
            f"avg={latency['average_ms']}ms p95={latency['p95_ms']}ms p99={latency['p99_ms']}ms",
        )
        report.add(
            "every transaction landed in a risk band",
            sum(entry["count"] for entry in metrics["risk_distribution"])
            == totals["total_transactions"],
        )

        feed = client.get("/api/transactions/recent?limit=25").json()
        report.add("GET /api/transactions/recent returns rows", feed["count"] > 0)

        alerts = client.get("/api/alerts?limit=25").json()
        report.add(
            "fraud alerts were raised",
            alerts["count"] > 0,
            f"{alerts['count']} alerts, types: "
            + ", ".join(sorted({alert["alert_type"] for alert in alerts["alerts"]})),
        )
        if alerts["count"]:
            first = alerts["alerts"][0]
            report.add(
                "alert carries a transaction, account and band",
                bool(first["transaction_id"] and first["account_id"])
                and first["risk_level"] in {"high", "critical"},
                f"{first['transaction_id']} {first['account_id']} {first['risk_level']}",
            )
            patched = client.patch(
                f"/api/alerts/{first['transaction_id']}", json={"status": "investigating"}
            )
            report.add("alert status can be triaged", patched.status_code == 200)

        accounts = client.get("/api/accounts/high-risk?minimum_level=low&limit=10").json()
        report.add(
            "GET /api/accounts/high-risk responds",
            accounts["count"] > 0,
            f"{accounts['count']} accounts",
        )
        escalated = client.get("/api/accounts/high-risk?minimum_level=high&limit=10").json()
        report.add(
            "accounts escalated to high risk",
            escalated["count"] > 0,
            f"{escalated['count']} accounts at high or critical",
        )
        if escalated["count"]:
            detail = client.get(f"/api/accounts/{escalated['accounts'][0]['account_id']}").json()
            report.add(
                "account detail exposes the signal breakdown",
                bool(detail.get("signals")) and len(detail["signals"]) == 7,
            )

        model = client.get("/api/model").json()
        report.add(
            "GET /api/model exposes the evaluation report",
            model.get("metrics", {}).get("test", {}).get("pr_auc") is not None,
            f"{model.get('model_name')} PR-AUC={model['metrics']['test']['pr_auc']}",
        )

        dataset = client.get("/api/dataset/info").json()
        report.add(
            "GET /api/dataset/info resolves the dataset",
            bool(dataset["stream_source"]["exists"]),
            f"{dataset['stream_source']['name']} ({dataset['stream_source']['rows']} rows)",
        )

        quality = metrics["live_quality"]
        report.add(
            "live confusion matrix covers every scored transaction",
            quality["true_positives"]
            + quality["false_positives"]
            + quality["true_negatives"]
            + quality["false_negatives"]
            == totals["total_transactions"],
        )

        # --- dataset upload (FR-001) -------------------------------------
        # Done last: streaming from the uploaded file resets the counters above.
        check_dataset_upload(client, report)

    return report


UPLOAD_NAME = "smoke_upload.csv"


def build_upload_csv(rows: int = 40) -> str:
    """A minimal, schema-valid CSV for the upload path."""
    header = ["Time"] + [f"V{index}" for index in range(1, 29)] + ["Amount", "Class"]
    lines = [",".join(header)]
    for row in range(rows):
        values = [str(row * 30)] + [f"{(row % 7) * 0.1:.4f}"] * 28 + [f"{10 + row}.50", "0"]
        lines.append(",".join(values))
    return "\n".join(lines) + "\n"


def check_dataset_upload(client: httpx.Client, report: "Report") -> None:
    payload = build_upload_csv()

    rejected = client.post(
        "/api/dataset/upload",
        files={"file": ("not-a-dataset.txt", b"nope", "text/plain")},
    )
    report.add(
        "non-CSV upload is rejected",
        rejected.status_code == 400,
        f"status={rejected.status_code}",
    )

    uploaded = client.post(
        "/api/dataset/upload",
        files={"file": (UPLOAD_NAME, payload.encode("utf-8"), "text/csv")},
    )
    report.add(
        "CSV upload is accepted and counted",
        uploaded.status_code == 200 and uploaded.json().get("rows") == 40,
        f"status={uploaded.status_code} rows={uploaded.json().get('rows') if uploaded.status_code == 200 else '-'}",
    )
    if uploaded.status_code != 200:
        return

    # Uploads are namespaced by uploader, so what streams the file is the
    # reference the engine returns ("<owner>/<file>.csv"), not its display name.
    reference = uploaded.json().get("source")

    listed = client.get("/api/dataset/info").json().get("uploads", [])
    stored = next((item for item in listed if item.get("source") == reference), None)
    report.add(
        "uploaded file appears in dataset info, attributed to its uploader",
        stored is not None and stored["name"] == UPLOAD_NAME and "owner_id" in stored,
        f"source={reference}",
    )

    client.post("/api/stream/stop")
    started = client.post(
        "/api/stream/start",
        json={"source": reference, "limit": 20, "delay_ms": 0, "persist": False, "reset": True},
    )
    report.add(
        "uploaded dataset can be streamed",
        started.status_code == 200,
        f"status={started.status_code} source={reference}",
    )
    report.add(
        "the live stream names the run's owner and file",
        started.status_code == 200 and started.json().get("source_ref") == reference,
    )

    deadline = time.time() + 30
    processed = 0
    while time.time() < deadline:
        status = client.get("/api/stream/status").json()
        processed = status["processed"]
        if processed >= 20 or not status["is_running"]:
            break
        time.sleep(0.3)
    report.add(
        "uploaded dataset is scored end to end",
        processed >= 20,
        f"processed={processed}",
    )
    client.post("/api/stream/stop")

    # Leave no test artifact behind.
    try:
        target = ENGINE_ROOT / "data" / "uploads" / UPLOAD_NAME
        if target.exists():
            target.unlink()
            report.add("uploaded test file cleaned up", True)
    except OSError as error:  # pragma: no cover
        report.add("uploaded test file cleaned up", False, str(error))


def main() -> int:
    parser = argparse.ArgumentParser(description="FraudStream AI end-to-end smoke test")
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--port", type=int, default=8099)
    parser.add_argument("--limit", type=int, default=400)
    parser.add_argument("--token", default=None, help="Supabase access token, if auth is enforced")
    parser.add_argument("--no-spawn", action="store_true", help="Test an already running server")
    args = parser.parse_args()

    base_url = args.base_url or f"http://127.0.0.1:{args.port}"
    server: Optional[subprocess.Popen] = None

    if not args.no_spawn and args.base_url is None:
        print(f"Starting uvicorn on port {args.port} ...")
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "src.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(args.port),
                "--log-level",
                "warning",
            ],
            cwd=str(ENGINE_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )

    try:
        report = run_checks(base_url, args.token, args.limit)
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()

    print("-" * 72)
    print(report.summary())
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
