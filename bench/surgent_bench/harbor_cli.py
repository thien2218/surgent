"""Harbor's CLI without its per-trial allowlist warning."""

from __future__ import annotations

import sys
import warnings

from harbor.cli.main import app

warnings.filterwarnings("ignore", message="Run-specific allowlist", category=UserWarning)

if __name__ == "__main__":
    sys.exit(app())
