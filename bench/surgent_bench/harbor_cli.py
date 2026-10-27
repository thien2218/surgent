"""Harbor's CLI without its per-trial allowlist warning or full error messages."""

from __future__ import annotations

import sys
import warnings
from typing import Any

from harbor.cli import trials
from harbor.cli.main import app

warnings.filterwarnings("ignore", message="Run-specific allowlist", category=UserWarning)
console_print = trials.console.print


def _print_brief(*objects: Any, **kwargs: Any) -> None:
    # After the error type, Harbor prints the agent's whole command and output; exception.txt keeps them.
    if objects and isinstance(objects[0], str) and objects[0].startswith("Message: "):
        return
    console_print(*objects, **kwargs)


trials.console.print = _print_brief

if __name__ == "__main__":
    sys.exit(app())
