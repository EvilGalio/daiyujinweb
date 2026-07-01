from pathlib import Path
from typing import Any

from services.cad_analyzer import analyze_cad_file


def analyze_step_file(file_path: str | Path, thumb_dir: str | Path) -> dict[str, Any]:
    return analyze_cad_file(file_path, thumb_dir)
