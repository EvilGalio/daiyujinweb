from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path

import pytest


@pytest.fixture()
def runner(monkeypatch):
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))
    import services.quote_cad_runner as runner_module

    return runner_module


def _runner_paths(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    backend_root = tmp_path / "backend"
    occ_python = tmp_path / "occ-python.exe"
    saved_path = tmp_path / "parts" / "part.step"
    thumbnail_dir = tmp_path / "thumbnails"
    backend_root.mkdir()
    occ_python.write_bytes(b"python")
    saved_path.parent.mkdir()
    saved_path.write_bytes(b"step")
    return backend_root, occ_python, saved_path, thumbnail_dir


def _run(runner, tmp_path: Path, **overrides):
    backend_root, occ_python, saved_path, thumbnail_dir = _runner_paths(tmp_path)
    arguments = {
        "backend_root": backend_root,
        "occ_python": occ_python,
        "saved_path": saved_path,
        "display_name": "part.step",
        "source_filename": "nested/part.step",
        "file_id": "file-id",
        "thumbnail_dir": thumbnail_dir,
        "timeout_seconds": 5,
    }
    arguments.update(overrides)
    return runner.run_cad_analysis(**arguments)


def test_parse_cli_payload_accepts_noise_before_json(runner) -> None:
    expected = {"success": True, "data": {"volume_mm3": 12.5}}
    stdout = "OffscreenRenderer content dumped to capture.jpeg\n" + json.dumps(expected)

    assert runner.parse_cli_payload(stdout) == expected


def test_runner_retries_communicate_without_blocking_on_noisy_child(
    runner,
    monkeypatch,
    tmp_path: Path,
) -> None:
    payload = {"success": True, "data": {"volume_mm3": 12.5}, "warnings": []}

    class FakeProcess:
        returncode = 0
        pid = 123

        def __init__(self) -> None:
            self.communicate_calls = 0

        def communicate(self, timeout):
            self.communicate_calls += 1
            if self.communicate_calls == 1:
                raise subprocess.TimeoutExpired("occ", timeout)
            return "renderer noise\n" + json.dumps(payload), ""

        def poll(self):
            return self.returncode

    process = FakeProcess()
    monkeypatch.setattr(runner.subprocess, "Popen", lambda *args, **kwargs: process)

    result = _run(runner, tmp_path)

    assert result["success"] is True
    assert result["data"]["volume_mm3"] == 12.5
    assert result["data"]["source_filename"] == "nested/part.step"
    assert process.communicate_calls == 2


def test_runner_cancels_child_between_communicate_polls(
    runner,
    monkeypatch,
    tmp_path: Path,
) -> None:
    cancel_event = threading.Event()

    class FakeProcess:
        returncode = None
        pid = 124

        def communicate(self, timeout):
            cancel_event.set()
            raise subprocess.TimeoutExpired("occ", timeout)

    process = FakeProcess()
    terminated = []
    monkeypatch.setattr(runner.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(runner, "_terminate_process_tree", lambda child: terminated.append(child))

    result = _run(runner, tmp_path, cancel_event=cancel_event)

    assert result["success"] is False
    assert result["error_code"] == "cad_cancelled"
    assert terminated == [process]


def test_runner_terminates_child_at_timeout(
    runner,
    monkeypatch,
    tmp_path: Path,
) -> None:
    class FakeProcess:
        returncode = None
        pid = 125

        def communicate(self, timeout):
            raise AssertionError("communicate should not run after the deadline")

    process = FakeProcess()
    terminated = []
    times = iter((0.0, 2.0))
    monkeypatch.setattr(runner.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(runner, "_terminate_process_tree", lambda child: terminated.append(child))
    monkeypatch.setattr(runner.time, "monotonic", lambda: next(times))

    result = _run(runner, tmp_path, timeout_seconds=1)

    assert result["success"] is False
    assert result["error_code"] == "cad_timeout"
    assert terminated == [process]
