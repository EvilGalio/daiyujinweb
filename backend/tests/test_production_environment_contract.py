from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_ENV = (
    r"C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot"
    r"\precision-tools\production.env"
)


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_production_environment_writer_is_acl_first_and_atomic() -> None:
    common = _read("PrecisionToolsEnvironment.Common.ps1")

    assert PRODUCTION_ENV in common
    assert '"S-1-5-19"' in common
    assert '"S-1-5-18"' in common
    assert '"S-1-5-32-544"' in common
    assert "IsPathRooted" in common
    assert "OrdinalIgnoreCase" in common
    assert "ReparsePoint" in common
    assert "AreAccessRulesProtected" in common
    assert "GetOwner" in common
    assert "owner must be Administrators" in common
    assert "grants an unexpected principal" in common
    assert "grants write access to LocalService" in common

    writer = common.split(
        "function Write-PrecisionToolsEnvironmentFileAtomic",
        1,
    )[1].split(
        "function Set-PrecisionToolsEnvironmentValues",
        1,
    )[0]
    assert ".environment-staging" in common
    assert "Initialize-PrecisionToolsEnvironmentLayout" in writer
    assert "Set-PrecisionToolsProtectedDirectoryAcl -Path $parent" not in writer
    empty_create = writer.index("[IO.FileMode]::CreateNew")
    staging_acl = writer.index(
        "Set-PrecisionToolsProtectedStagingFileAcl -Path $temporaryPath"
    )
    exclusive_write = writer.index("[IO.FileMode]::Open", staging_acl)
    stream_writer = writer.index("[IO.StreamWriter]::new", exclusive_write)
    durable_flush = writer.index("$stream.Flush($true)", stream_writer)
    final_acl = writer.index(
        "Set-PrecisionToolsProtectedFileAcl -Path $temporaryPath",
        durable_flush,
    )
    atomic_replace = writer.index("[IO.File]::Replace", final_acl)
    atomic_move = writer.index("[IO.File]::Move", final_acl)

    assert empty_create < staging_acl < exclusive_write < stream_writer
    assert stream_writer < durable_flush < final_acl < atomic_replace
    assert stream_writer < durable_flush < final_acl < atomic_move
    assert "[IO.FileShare]::None" in writer
    assert "WriteThrough" in writer
    assert "Assert-PrecisionToolsProductionEnvironmentFile" in writer


def test_initializer_creates_only_the_fixed_external_environment() -> None:
    initializer = _read("Initialize-PrecisionToolsFreshPc.ps1")

    assert PRODUCTION_ENV in initializer
    assert "Assert-PrecisionToolsFixedEnvironmentPath" in initializer
    assert "Write-PrecisionToolsEnvironmentFileAtomic" in initializer
    assert "-RequireNew" in initializer
    assert "Import-PrecisionToolsEnvironmentFile -Path $envPath -Production" in initializer
    assert "-EnvironmentFile $envPath" in initializer
    assert "Set-RestrictedFileAcl" not in initializer
    assert "[IO.File]::WriteAllLines" not in initializer
    assert "Production initialization refuses repository-local backend\\.env" in initializer
    assert initializer.count('Join-Path $root "backend\\.env"') == 1


def test_runtime_acl_validates_fixed_file_for_local_service() -> None:
    acl = _read("Set-PrecisionToolsRuntimeAcl.ps1")

    assert PRODUCTION_ENV in acl
    assert "Assert-PrecisionToolsFixedEnvironmentPath" in acl
    assert "Assert-PrecisionToolsProductionEnvironmentFile" in acl
    assert '"S-1-5-19"' in acl
    assert "Add-SidRule -Path $environment" not in acl
    assert 'Join-Path $backendRoot ".env"' not in acl
    assert "Assert-PrecisionToolsPathContained" in acl
    assert "Assert-PrecisionToolsTrustedMutationAcl" in acl
    assert "Assert-PrecisionToolsBootstrapSource" in acl
    assert "-CommonPath $environmentCommon" in acl
    assert "-ContainmentRoot $containmentRoot" in acl
    assert "Assert-PrecisionToolsTrustedExecutable" in acl
    assert "function Set-LegacyHandoffBoundaryAcl" in acl
    legacy_acl = acl.split(
        "function Set-LegacyHandoffBoundaryAcl",
        1,
    )[1].split(
        "function Assert-ProtectedSecretsCsvAcl",
        1,
    )[0]
    assert r"C:\daiyujin\daiyujinweb\backend\private" in legacy_acl
    assert "FileSystemRights]::Traverse" in legacy_acl
    assert "FileSystemRights]::ReadAttributes" in legacy_acl
    assert "FileSystemRights]::Synchronize" in legacy_acl
    assert "FileSystemRights]::ReadAndExecute" in legacy_acl
    assert "FileSystemRights]::Modify" in legacy_acl
    assert "$operator" not in legacy_acl.lower()
    assert "$runtimeDirectories += $handoffStagingRoot" not in acl
    assert "Add-SidRule `\n        -Path $fixedPrivateRoot" not in acl


def test_production_launchers_require_explicit_environment_file() -> None:
    api = _read("run-api.ps1")
    worker = _read("run-quote-worker.ps1")
    exchange = _read("run-exchange-rate-update.ps1")

    for source, label in (
        (api, "API"),
        (worker, "quote-worker"),
        (exchange, "exchange-rate"),
    ):
        assert "[string]$EnvironmentFile" in source
        assert "[switch]$Development" in source
        assert f"Production {label} launch requires explicit -EnvironmentFile" in source
        assert "Import-PrecisionToolsEnvironmentFile" in source
        assert "-Production" in source
        assert "function Import-EnvFile" not in source

    assert 'Join-Path $BackendRoot ".env"' in api
    assert 'Join-Path $BackendRoot ".env"' in worker
    assert 'Join-Path $BackendRoot ".env"' in exchange
    assert "if ($Development)" in api
    assert "if ($Development)" in worker
    assert "if ($Development)" in exchange
    assert "$BackendRoot / \".env\"" not in _read("backend/app.py")
    assert 'BACKEND_ROOT / ".env"' not in _read("backend/app.py")


def test_all_production_tasks_pass_environment_file_as_local_service() -> None:
    api = _read("Install-PrecisionToolsApiTask.ps1")
    worker = _read("Install-Quote-Worker-Task.ps1")
    exchange = _read("Install-Exchange-Rate-Task.ps1")

    for source in (api, worker, exchange):
        assert PRODUCTION_ENV in source
        assert '"-EnvironmentFile"' in source
        assert '"S-1-5-19"' in source
        assert "Assert-PrecisionToolsProductionEnvironmentFile" in source
        assert "-EnvironmentFile $EnvironmentFile" in source or (
            "-EnvironmentFile $environment" in source
        )
        assert "NEXTGEN_LEGACY_HANDOFF_SECRET" not in source
        assert "QUOTE_HANDOFF_SIGNING_SECRET" not in source

    assert '-UserId "SYSTEM"' not in exchange
    assert "RunAsSystem" not in exchange
    assert "[switch]$RunAsLocalService" in exchange
    assert "-RunLevel Limited" in exchange
    assert "BACKEND_PYTHON" in _read("run-exchange-rate-update.ps1")
    assert "OCC_PYTHON configured" not in _read("run-exchange-rate-update.ps1")


def test_update_and_archive_wiring_preserve_protected_environment() -> None:
    updater = _read("Update-Company-PC.ps1")
    archive = _read("backend/scripts/enable_archive_uploads.ps1")

    assert PRODUCTION_ENV in updater
    assert "$EnvFile = Assert-PrecisionToolsProductionEnvironmentFile" in updater
    assert updater.count('"-EnvironmentFile"') >= 5
    assert '"-Production"' in updater
    assert '"INSTALL_QUOTE_WORKER_TASK"' in updater
    assert 'Join-Path $BackendRoot ".env"' not in updater

    assert "Select exactly one of -Production or -Development" in archive
    assert "Production archive setup requires explicit -EnvironmentFile" in archive
    assert "Set-PrecisionToolsEnvironmentValues" in archive
    assert "-Values $environmentUpdates" in archive
    production_write = archive.split("if ($Production) {", 2)[-1]
    assert "Set-PrecisionToolsEnvironmentValues" in production_write


def test_production_executables_are_explicit_and_acl_validated() -> None:
    common = _read("PrecisionToolsEnvironment.Common.ps1")
    updater = _read("Update-Company-PC.ps1")
    archive = _read("backend/scripts/enable_archive_uploads.ps1")
    worker = _read("run-quote-worker.ps1")

    assert "function Assert-PrecisionToolsTrustedExecutable" in common
    assert "Assert-PrecisionToolsTrustedMutationAcl" in common
    assert "is outside the approved production roots" in common
    assert "has an untrusted owner" in common
    assert "grants mutation rights to an untrusted principal" in common

    resolver = updater.split("function Resolve-PythonRuntime", 1)[1].split(
        "function Resolve-PythonRuntimes",
        1,
    )[0]
    assert "Assert-PrecisionToolsTrustedExecutable" in resolver
    assert "GetEnvironmentVariable" not in resolver
    assert "FallbackPaths" not in resolver
    resolution = updater.split("function Resolve-PythonRuntimes", 1)[1].split(
        "function Ensure-RuntimeDirectories",
        1,
    )[0]
    assert 'Join-Path $ProjectRoot ".venv"' in resolution
    assert r"C:\ProgramData\Daiyujin\Dependencies" in resolution
    assert "USERPROFILE" not in resolution
    assert "LOCALAPPDATA" not in resolution

    strict_resolver = archive.split("function Resolve-PythonPath", 1)[1].split(
        "function Invoke-Python",
        1,
    )[0]
    assert "StrictProduction" in strict_resolver
    assert "Assert-PrecisionToolsTrustedExecutable" in strict_resolver
    rar_resolver = archive.split("function Find-RarTool", 1)[1].split(
        "if ($EnableAsyncArchives",
        1,
    )[0]
    assert "if (-not $Production)" in rar_resolver
    assert "Get-Command" in rar_resolver
    assert "Assert-PrecisionToolsTrustedExecutable" in rar_resolver

    assert "Production quote-worker launch requires explicit Python runtimes" in worker
    assert "if ($Development)" in worker
    assert "-FallbackPaths $commonPythonPaths" in worker
    assert "Production quote-worker Python runtimes do not match" in worker
    assert r"C:\ProgramData\Daiyujin\Dependencies" in worker


def test_archive_database_override_never_uses_process_arguments() -> None:
    archive = _read("backend/scripts/enable_archive_uploads.ps1")
    repair_block = archive.split('$repairArgs = @("-B", $RepairScript)', 1)[1].split(
        "$rarTool = Find-RarTool",
        1,
    )[0]

    assert "--database-url" not in archive
    assert "EnvironmentVariableTarget]::Process" in repair_block
    assert '"DATABASE_URL"' in repair_block
    assert "$previousDatabaseUrl" in repair_block
    assert "$DatabaseUrl = \"\"" in repair_block
