"""Where the labelled fraud sits inside the stream file.

Fraud is rare: 52 cases in the 42,560 row test split. Streaming from row zero at
a watchable rate means several minutes before anything gets flagged, which makes
a live demo look broken and makes manual verification tedious.

This module indexes the labelled positions so an operator can deliberately start
from a fraud-dense window. Event order inside the window is untouched: only the
starting offset changes, and the UI states which row it started from.

Written by the training pipeline, and regenerable on its own:

    python -m src.streaming.index
"""

from __future__ import annotations

import csv
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from ..config import DATA_DIR, TARGET_COLUMN, settings

logger = logging.getLogger(__name__)

INDEX_FILENAME = "stream_fraud_index.json"
DEFAULT_WINDOW = 400
#: Start a little before the first fraud so the feed has context first.
LEAD_IN_ROWS = 15


def find_fraud_rows(source: Path) -> tuple[int, List[int]]:
    """Return (total data rows, 1-based row numbers whose label is fraud)."""
    total = 0
    fraud_rows: List[int] = []
    with Path(source).open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if TARGET_COLUMN not in (reader.fieldnames or []):
            return 0, []
        for row_number, row in enumerate(reader, start=1):
            total = row_number
            raw = row.get(TARGET_COLUMN)
            if raw in (None, ""):
                continue
            try:
                if int(float(raw)) == 1:
                    fraud_rows.append(row_number)
            except (TypeError, ValueError):
                continue
    return total, fraud_rows


def densest_window(fraud_rows: List[int], window: int = DEFAULT_WINDOW) -> Optional[Dict[str, int]]:
    """Find the window of ``window`` rows containing the most labelled fraud."""
    if not fraud_rows:
        return None

    best = {"start": max(fraud_rows[0] - LEAD_IN_ROWS, 0), "fraud_count": 0}
    left = 0
    for right, position in enumerate(fraud_rows):
        while position - fraud_rows[left] >= window:
            left += 1
        count = right - left + 1
        if count > best["fraud_count"]:
            best = {
                "start": max(fraud_rows[left] - LEAD_IN_ROWS, 0),
                "fraud_count": count,
            }

    best["window_size"] = window
    best["end"] = best["start"] + window
    return best


def build_index(source: Optional[Path] = None, window: int = DEFAULT_WINDOW) -> Dict[str, object]:
    """Index the stream file and write ``data/stream_fraud_index.json``."""
    path = Path(source or settings.stream_data_path)
    if not path.exists():
        logger.warning("Cannot index %s: file does not exist", path)
        return {}

    total, fraud_rows = find_fraud_rows(path)
    window_info = densest_window(fraud_rows, window)

    index: Dict[str, object] = {
        "source": path.name,
        "total_rows": total,
        "fraud_count": len(fraud_rows),
        "fraud_rate": round(len(fraud_rows) / total, 6) if total else 0.0,
        "first_fraud_row": fraud_rows[0] if fraud_rows else None,
        "fraud_rows": fraud_rows[:200],
        "recommended_skip": (
            max(fraud_rows[0] - LEAD_IN_ROWS, 0) if fraud_rows else 0
        ),
        "densest_window": window_info,
        "note": (
            "Chronological order is preserved. These offsets only let an operator "
            "start the stream near labelled fraud instead of waiting for it."
        ),
    }

    target = DATA_DIR / INDEX_FILENAME
    target.write_text(json.dumps(index, indent=2), encoding="utf-8")
    logger.info(
        "Indexed %s: %s fraud rows in %s, first at row %s, densest window %s",
        path.name,
        len(fraud_rows),
        total,
        index["first_fraud_row"],
        window_info,
    )
    return index


def load_index() -> Optional[Dict[str, object]]:
    target = DATA_DIR / INDEX_FILENAME
    if not target.exists():
        return None
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


if __name__ == "__main__":
    logging.basicConfig(level="INFO", format="%(levelname)-7s %(message)s")
    print(json.dumps(build_index(), indent=2)[:800])
