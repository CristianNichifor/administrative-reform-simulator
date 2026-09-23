"""Canonical paths. Everything is resolved from the repo root, never from the cwd.

The data tree may live outside the repository, in a data root that is backed up
on its own. Point ADMIN_REFORM_DATA_DIR at it; unset, ``data/`` under the repo
root is used, exactly as before.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent

DATA_DIR: Final = (
    Path(os.environ["ADMIN_REFORM_DATA_DIR"]).expanduser().resolve()
    if os.environ.get("ADMIN_REFORM_DATA_DIR")
    else REPO_ROOT / "data"
)
RAW_DIR: Final = DATA_DIR / "raw"
PROCESSED_DIR: Final = DATA_DIR / "processed"

WEB_DATA_DIR: Final = REPO_ROOT / "web" / "public" / "data"
DOCS_DIR: Final = REPO_ROOT / "docs"

# Data-quality reports are build output, not artefacts, so they live under data/.
REPORTS_DIR: Final = PROCESSED_DIR / "reports"
