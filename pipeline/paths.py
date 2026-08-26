"""Canonical paths. Everything is resolved from the repo root, never from the cwd."""

from __future__ import annotations

from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

DATA_DIR: Final = REPO_ROOT / "data"
RAW_DIR: Final = DATA_DIR / "raw"
PROCESSED_DIR: Final = DATA_DIR / "processed"

WEB_DATA_DIR: Final = REPO_ROOT / "web" / "public" / "data"
DOCS_DIR: Final = REPO_ROOT / "docs"

# Data-quality reports are build output, not artefacts, so they live under data/.
REPORTS_DIR: Final = PROCESSED_DIR / "reports"
