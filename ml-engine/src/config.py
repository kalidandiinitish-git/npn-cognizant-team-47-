"""Central configuration for the FraudStream AI ML engine.

Every tunable value lives here so the training pipeline, the streaming engine
and the API all agree on paths, thresholds and risk bands.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

try:  # python-dotenv is optional at import time so tests can run without it.
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    def load_dotenv(*_args, **_kwargs):  # type: ignore
        return False


ML_ENGINE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ENGINE_ROOT.parent
WORKSPACE_ROOT = REPO_ROOT.parent

load_dotenv(ML_ENGINE_ROOT / ".env")

DATA_DIR = ML_ENGINE_ROOT / "data"
MODELS_DIR = ML_ENGINE_ROOT / "models"
UPLOAD_DIR = DATA_DIR / "uploads"

# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

#: The raw dataset is ~150 MB, so it is not copied into the repository.
#: These locations are searched in order when DATA_PATH is not set.
DATASET_SEARCH_PATHS: Tuple[Path, ...] = (
    DATA_DIR / "creditcard.csv",
    REPO_ROOT / "creditcard.csv",
    WORKSPACE_ROOT / "creditcard.csv",
)

#: Columns produced by the ULB credit card fraud dataset.
PCA_FEATURES: Tuple[str, ...] = tuple(f"V{i}" for i in range(1, 29))
RAW_REQUIRED_COLUMNS: Tuple[str, ...] = ("Time",) + PCA_FEATURES + ("Amount",)
TARGET_COLUMN = "Class"

#: Features the model is actually trained on. Derived identity attributes
#: (account, merchant, location) are deliberately excluded - see docs/model-card.md.
ENGINEERED_FEATURES: Tuple[str, ...] = (
    "amount",
    "log_amount",
    "seconds_of_day",
    "hour_of_day",
    "is_night",
)
MODEL_FEATURES: Tuple[str, ...] = PCA_FEATURES + ENGINEERED_FEATURES


# ---------------------------------------------------------------------------
# Risk bands (PRD: functional_requirements.FR-007 / risk_engine)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RiskBand:
    level: str
    lower: float
    upper: float
    action: str


RISK_BANDS: Tuple[RiskBand, ...] = (
    RiskBand("low", 0.00, 0.40, "Allow"),
    RiskBand("medium", 0.40, 0.70, "Monitor"),
    RiskBand("high", 0.70, 0.90, "Flag"),
    RiskBand("critical", 0.90, 1.01, "Alert and investigate"),
)

#: A transaction at or above this risk score raises a fraud alert (FR-010).
ALERT_RISK_SCORE = 0.70

#: Account level risk thresholds (FR-011).
ACCOUNT_RISK_BANDS: Tuple[RiskBand, ...] = RISK_BANDS

#: PRD performance target PR-001.
LATENCY_TARGET_MS = 50.0


# ---------------------------------------------------------------------------
# Training configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TrainingConfig:
    """Knobs for the offline training pipeline."""

    # Time aware split: the dataset is ordered by elapsed seconds, so the split
    # is done on row order after sorting by Time to avoid future leakage.
    train_fraction: float = 0.70
    validation_fraction: float = 0.15
    # Remaining 15 % becomes the test split, which also feeds the pseudo-stream.

    random_state: int = 42

    #: Minimum precision the tuned threshold must keep while maximising recall.
    min_precision: float = 0.50
    #: Recall weight used by the F-beta threshold search (beta > 1 favours recall).
    fbeta_beta: float = 2.0

    #: Number of test rows used for the latency benchmark.
    latency_sample_size: int = 500

    #: Optional row cap, useful for a fast smoke run (`--max-rows`).
    max_rows: Optional[int] = None


TRAINING = TrainingConfig()


# ---------------------------------------------------------------------------
# Runtime settings (API + streaming)
# ---------------------------------------------------------------------------

def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(float(raw))
    except ValueError:
        return default


def _resolve(path_value: str, default: Path) -> Path:
    if not path_value:
        return default
    candidate = Path(path_value)
    if not candidate.is_absolute():
        candidate = ML_ENGINE_ROOT / candidate
    return candidate


@dataclass
class Settings:
    """Environment driven runtime settings."""

    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", "").strip())
    supabase_service_role_key: str = field(
        default_factory=lambda: os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )
    supabase_anon_key: str = field(default_factory=lambda: os.getenv("SUPABASE_ANON_KEY", "").strip())

    model_path: Path = field(
        default_factory=lambda: _resolve(
            os.getenv("MODEL_PATH", ""), MODELS_DIR / "fraud_model.joblib"
        )
    )
    preprocessor_path: Path = field(
        default_factory=lambda: _resolve(
            os.getenv("PREPROCESSOR_PATH", ""), MODELS_DIR / "preprocessor.joblib"
        )
    )
    metadata_path: Path = field(
        default_factory=lambda: _resolve(
            os.getenv("MODEL_METADATA_PATH", ""), MODELS_DIR / "model_metadata.json"
        )
    )

    data_path_override: str = field(default_factory=lambda: os.getenv("DATA_PATH", "").strip())
    stream_data_path: Path = field(
        default_factory=lambda: _resolve(
            os.getenv("STREAM_DATA_PATH", ""), DATA_DIR / "stream_test.csv"
        )
    )

    stream_delay_ms: int = field(default_factory=lambda: _env_int("STREAM_DELAY_MS", 120))
    stream_max_transactions: int = field(
        default_factory=lambda: _env_int("STREAM_MAX_TRANSACTIONS", 50_000)
    )
    persist_batch_size: int = field(default_factory=lambda: _env_int("PERSIST_BATCH_SIZE", 25))
    #: Whether booting the engine also starts the stream.
    #:
    #: Every counter the dashboard reads lives in this process's memory, and the
    #: free Render plan stops the instance after ~15 minutes without a request.
    #: Waking it therefore produces a healthy engine with an idle stream and zero
    #: transactions, so a visitor arriving after a quiet spell sees an empty
    #: dashboard and reads it as broken. Starting the stream on boot makes the
    #: instance self-restoring: whatever stopped it, it comes back serving data.
    #: Off by default so tests and local runs keep control of the stream, and set
    #: to "true" for the deployed demo in render.yaml.
    stream_autostart: bool = field(
        default_factory=lambda: _env_bool("STREAM_AUTOSTART", False)
    )

    api_host: str = field(default_factory=lambda: os.getenv("API_HOST", "0.0.0.0"))
    api_port: int = field(default_factory=lambda: _env_int("API_PORT", 8000))
    #: Defaults cover both Vite commands: `dev` serves on 5173 and `preview`
    #: serves the production build on 4173. Override in production.
    cors_origins: List[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173,"
                "http://localhost:4173,http://127.0.0.1:4173,"
                "http://localhost:3000,http://127.0.0.1:3000,"
                "http://localhost:8000,http://127.0.0.1:8000,"
                "http://localhost:5174,http://127.0.0.1:5174",
            ).split(",")
            if origin.strip()
        ]
    )
    #: Origins that cannot be listed one by one, because the platform issues a
    #: new hostname per deployment. Vercel gives each project and each preview
    #: its own host — fraudstream-ai.vercel.app, fraudstream-ai-iota.vercel.app,
    #: npn-cognizant-team-47-seven.vercel.app, plus a -git-<branch>- and a
    #: -<hash>-<team> host for every push. An exact allow-list matches whichever
    #: of those was current when it was written and silently stops matching on
    #: the next deploy, at which point the engine still answers 200 but the
    #: browser discards the response and the dashboard fabricates its numbers.
    #: Matching the project's host *shape* is what survives a redeploy.
    #: Anchored at both ends: `...vercel.app.evil.com` must not match, and
    #: neither must a host that merely contains the project name.
    cors_origin_regex: str = field(
        default_factory=lambda: os.getenv(
            "CORS_ORIGIN_REGEX",
            r"^(?:https?://(?:localhost|127\.0\.0\.1)(?::\d+)?"
            r"|https://(?:fraudstream-ai|npn-cognizant-team-47)[a-z0-9-]*\.vercel\.app)$",
        )
    )
    require_auth: bool = field(default_factory=lambda: _env_bool("REQUIRE_AUTH", True))
    #: Whether REQUIRE_AUTH was set at all. "Unset" and "true" must be told
    #: apart: unset is a developer who has not thought about it and gets the
    #: permissive local default, while an explicit true is an operator asking
    #: for authentication, which must never silently degrade to open access.
    require_auth_explicit: bool = field(
        default_factory=lambda: bool(os.getenv("REQUIRE_AUTH", "").strip())
    )
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO").upper())

    #: How many recent records the in-memory buffers keep for the API fallback.
    buffer_size: int = 500

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def _auth_credentials_present(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def auth_enabled(self) -> bool:
        """Auth can only be enforced when Supabase Auth is reachable."""
        return bool(self.require_auth and self._auth_credentials_present)

    @property
    def auth_misconfigured(self) -> bool:
        """Authentication was explicitly demanded but cannot be performed.

        Deploying with REQUIRE_AUTH=true and no Supabase keys used to serve
        every route unauthenticated: the flag that was supposed to lock the
        service down was exactly what got ignored. render.yaml sets this flag
        while leaving the keys to be filled in by hand, so the gap is one
        forgotten dashboard field wide. The API refuses to serve protected
        routes in that state rather than failing open.
        """
        return bool(
            self.require_auth
            and self.require_auth_explicit
            and not self._auth_credentials_present
        )

    def resolve_dataset_path(self) -> Optional[Path]:
        """Locate the historical dataset, honouring DATA_PATH when provided."""
        if self.data_path_override:
            candidate = Path(self.data_path_override)
            if not candidate.is_absolute():
                candidate = ML_ENGINE_ROOT / candidate
            return candidate if candidate.exists() else None
        for candidate in DATASET_SEARCH_PATHS:
            if candidate.exists():
                return candidate
        return None


settings = Settings()


def ensure_directories() -> None:
    """Create the writable directories the engine expects."""
    for directory in (DATA_DIR, MODELS_DIR, UPLOAD_DIR):
        directory.mkdir(parents=True, exist_ok=True)
