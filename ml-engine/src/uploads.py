"""Ownership for the uploads directory.

The engine is one shared workspace by design — a fraud team works a single alert
queue — but `data/uploads` was keyed on file name alone, so two accounts
uploading `transactions.csv` wrote to the same path and the second silently
destroyed the first. Uploads are therefore stored under a per-uploader
directory, and each one carries a small sidecar recording who put it there so
the dashboard can attribute it instead of showing an anonymous list.

Layout::

    data/uploads/<owner-slug>/<file>.csv
    data/uploads/<owner-slug>/<file>.csv.owner.json
    data/uploads/<file>.csv                 # predates namespacing, still served

A stream `source` is the path relative to the uploads root — ``<owner>/<file>``
for an owned upload, a bare name for a legacy one.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, Optional, Tuple

logger = logging.getLogger(__name__)

#: Anything outside this set is replaced, so an identity from an external
#: provider can never contribute a path separator or a `..` to a directory name.
UNSAFE_IN_SLUG = re.compile(r"[^A-Za-z0-9_-]")

#: Where a user id that sanitises away to nothing ends up. Not reachable from a
#: Supabase UUID; present so the function is total.
FALLBACK_OWNER_SLUG = "unknown"

#: Suffix of the attribution sidecar. It sits beside the CSV rather than in a
#: manifest so a half-written upload cannot corrupt the record of the others.
OWNER_SUFFIX = ".owner.json"


def owner_slug(user_id: Optional[str]) -> str:
    """Directory name for an account. Supabase UUIDs pass through unchanged."""
    slug = UNSAFE_IN_SLUG.sub("_", str(user_id or "").strip())
    return slug or FALLBACK_OWNER_SLUG


def owner_directory(upload_root: Path, user_id: Optional[str]) -> Path:
    return upload_root / owner_slug(user_id)


def _sidecar_path(csv_path: Path) -> Path:
    return csv_path.with_name(csv_path.name + OWNER_SUFFIX)


def write_owner_record(
    csv_path: Path, user_id: Optional[str], email: Optional[str]
) -> None:
    """Record who uploaded a file, next to the file.

    Best effort: attribution is worth having but is not worth failing an upload
    the engine has already accepted and verified.
    """
    record = {
        "owner_id": str(user_id) if user_id else None,
        "owner_email": email,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        _sidecar_path(csv_path).write_text(json.dumps(record), encoding="utf-8")
    except OSError as error:  # pragma: no cover - disk-full / read-only volume
        logger.warning("Could not record the uploader of %s: %s", csv_path, error)


def read_owner_record(csv_path: Path) -> Dict[str, Any]:
    """Attribution for a stored upload, or empty values when there is none.

    A file that predates namespacing has no sidecar and no way to recover one.
    Reporting the uploader as unknown is the honest answer; inventing one would
    put a name against a file that account may never have touched.
    """
    empty = {"owner_id": None, "owner_email": None, "uploaded_at": None}
    path = _sidecar_path(csv_path)
    if not path.exists():
        return empty
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        logger.warning("Could not read %s: %s", path, error)
        return empty
    if not isinstance(loaded, dict):
        return empty
    return {**empty, **{key: loaded.get(key) for key in empty}}


def remove_upload(csv_path: Path) -> None:
    """Delete a stored upload and its sidecar together."""
    csv_path.unlink(missing_ok=True)
    _sidecar_path(csv_path).unlink(missing_ok=True)


def reference_for(upload_root: Path, csv_path: Path) -> str:
    """The `source` value that streams this file: its path under the root."""
    return csv_path.relative_to(upload_root).as_posix()


def iter_uploads(upload_root: Path) -> Iterator[Tuple[Path, str]]:
    """Every stored upload, newest layout and legacy alike.

    Yields ``(path, reference)`` sorted by reference so the dashboard's list is
    stable between polls.
    """
    if not upload_root.exists():
        return
    found = list(upload_root.glob("*.csv")) + list(upload_root.glob("*/*.csv"))
    for path in sorted(found, key=lambda item: item.as_posix()):
        yield path, reference_for(upload_root, path)


def resolve_within(base: Path, reference: str) -> Optional[Path]:
    """Resolve *reference* under *base*, or None if it points outside it.

    The request schema already rejects traversal, but this is the check that
    actually protects the filesystem: a symlink inside the uploads tree, or any
    future caller that skips the schema, still cannot read its way out.
    """
    try:
        candidate = (base / reference).resolve()
        root = base.resolve()
    except OSError:  # pragma: no cover - broken symlink chain
        return None
    if candidate != root and root not in candidate.parents:
        return None
    return candidate if candidate.is_file() else None
