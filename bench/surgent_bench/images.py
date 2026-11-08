"""Materialize and pull one task image in a cancellable background process."""

import subprocess
import sys
from pathlib import Path

from harbor.models.trial.config import TaskConfig

from surgent_bench.driver import task_image


if __name__ == "__main__":
    image = task_image(TaskConfig.model_validate_json(sys.argv[1]))
    Path(sys.argv[2]).write_text(image or "")
    if image is not None:
        raise SystemExit(subprocess.call(
            ["docker", "pull", "--", image], stdout=subprocess.DEVNULL,
        ))
