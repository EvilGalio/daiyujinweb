from __future__ import annotations

import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_tracked_paths_are_unique_on_case_insensitive_filesystems() -> None:
    git = shutil.which("git")
    if git is None:
        pytest.skip("Git is required for the repository path contract")

    completed = subprocess.run(
        [git, "-C", str(ROOT), "ls-files", "-z"],
        check=True,
        capture_output=True,
    )
    paths = [
        path
        for path in completed.stdout.decode("utf-8").split("\0")
        if path
    ]
    by_casefolded_path: dict[str, list[str]] = defaultdict(list)
    for path in paths:
        by_casefolded_path[path.casefold()].append(path)

    collisions = {
        normalized: sorted(entries)
        for normalized, entries in by_casefolded_path.items()
        if len(entries) > 1
    }
    assert collisions == {}
