from __future__ import annotations

import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = ROOT / "daiyujin-tools"
MAIN_PLUGIN = PLUGIN_ROOT / "daiyujin-tools.php"
CANONICAL_PORTAL = "https://portal.daiyujin.dpdns.org"


def _run_build(project_root: Path, output: Path) -> subprocess.CompletedProcess:
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if powershell is None:
        pytest.skip("PowerShell is required to test the WordPress package")
    return subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(project_root / "Build-DyjToolsZip.ps1"),
            "-Theme",
            "mfg",
            "-OutputPath",
            str(output),
        ],
        cwd=project_root,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def _plugin_versions(source: str) -> tuple[str, str]:
    header = re.search(r"(?m)^\s*\*\s*Version:\s*(\d+\.\d+\.\d+)\s*$", source)
    constant = re.search(
        r"define\(\s*'DYJ_TOOLS_VERSION'\s*,\s*'(\d+\.\d+\.\d+)'\s*\)",
        source,
    )
    assert header is not None
    assert constant is not None
    return header.group(1), constant.group(1)


def test_plugin_version_portal_and_company_contract() -> None:
    php = MAIN_PLUGIN.read_text(encoding="utf-8")
    quote_js = (PLUGIN_ROOT / "assets/js/quote.js").read_text(encoding="utf-8")
    root_quote_js = (ROOT / "js/quote.js").read_text(encoding="utf-8")

    assert _plugin_versions(php) == ("1.6.1", "1.6.1")
    assert CANONICAL_PORTAL in php
    assert CANONICAL_PORTAL in quote_js
    assert CANONICAL_PORTAL in root_quote_js
    assert "https://portal.mfg-solution.com" not in php
    assert "https://portal.mfg-solution.com" not in quote_js
    assert "DYJ_TOOLS_CUSTOMER_COMPANY_CODE" in php
    assert "dyj_tools_customer_company_code()" in php

    handoff = quote_js.split(
        "async function continueToEngineeringReview",
        1,
    )[1].split("function bindPreviewTabs", 1)[0]
    assert "site: currentSite()" in handoff
    assert "return_url" not in handoff
    assert "destination.origin !== expected.origin" in handoff
    assert "localDestination" not in handoff
    assert "file_receipt: part.analysis.file_receipt" in quote_js
    assert "file_receipt: item.file_receipt" in quote_js


def test_plugin_readme_documents_primary_customer_entry() -> None:
    readme = (PLUGIN_ROOT / "README.md").read_text(encoding="utf-8")

    assert '[dyj_quote_tool theme="mfg"]' in readme
    assert '[dyj_portal_entry theme="mfg"]' in readme
    assert "DYJ_TOOLS_CUSTOMER_PORTAL_URL" in readme
    assert "DYJ_TOOLS_CUSTOMER_COMPANY_CODE" in readme
    assert CANONICAL_PORTAL in readme
    assert "1.6.1" in readme


def test_build_script_produces_one_valid_plugin_root(tmp_path: Path) -> None:
    output = tmp_path / "daiyujin-tools-1.6.1-mfg.zip"
    completed = _run_build(ROOT, output)
    assert completed.returncode == 0, completed.stderr
    assert output.is_file()

    forbidden = re.compile(
        r"(?i)(^|/)(?:\.git|_private|uploads?|backups?|logs?|"
        r"tests?|test-output|data|\.pytest_cache|__pycache__|htmlcov|"
        r"\.mypy_cache|\.ruff_cache|\.tox|\.venv|venv|node_modules)(?:/|$)|"
        r"(^|/)\.env(?:\.|$)|"
        r"\.(?:db|sqlite|sqlite3|log|zip|7z|rar|bak|pyc|pyo|key|pem|"
        r"pfx|p12|jks|keystore|map)$|"
        r"(^|/)(?:\.coverage|coverage\.xml|junit\.xml|pytest\.xml)$|"
        r"(?:secret|password|token)"
    )
    with zipfile.ZipFile(output) as archive:
        names = [name.replace("\\", "/") for name in archive.namelist()]
        assert archive.testzip() is None
        assert names
        assert all(name.startswith("daiyujin-tools/") for name in names)
        assert not any(forbidden.search(name) for name in names)
        assert "daiyujin-tools/daiyujin-tools.php" in names
        assert "daiyujin-tools/assets/js/quote.js" in names
        assert "daiyujin-tools/templates/portal-entry.php" in names
        assert "daiyujin-tools/assets/css/themes/mfg.css" in names
        assert "daiyujin-tools/assets/css/themes/gcindus.css" not in names
        packaged_php = archive.read(
            "daiyujin-tools/daiyujin-tools.php"
        ).decode("utf-8")

    assert _plugin_versions(packaged_php) == ("1.6.1", "1.6.1")


@pytest.mark.parametrize(
    "forbidden_path",
    [
        ".pytest_cache/state",
        "__pycache__/plugin.pyc",
        "htmlcov/index.html",
        ".coverage",
        "coverage.xml",
        "assets/js/debug.map",
        "assets/private.pem",
    ],
)
def test_build_script_rejects_forbidden_artifacts(
    tmp_path: Path,
    forbidden_path: str,
) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    shutil.copy2(ROOT / "Build-DyjToolsZip.ps1", project_root)
    shutil.copytree(PLUGIN_ROOT, project_root / "daiyujin-tools")
    injected = project_root / "daiyujin-tools" / forbidden_path
    injected.parent.mkdir(parents=True, exist_ok=True)
    injected.write_text("must not be packaged", encoding="utf-8")
    output = tmp_path / "forbidden.zip"

    completed = _run_build(project_root, output)

    assert completed.returncode != 0
    assert not output.exists()
    assert "Forbidden plugin source path" in (
        completed.stdout + completed.stderr
    )
