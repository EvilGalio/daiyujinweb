from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8-sig")


def test_restore_is_installed_inside_the_manifest_pinned_runtime() -> None:
    installer = _read("Install-PrecisionToolsBackupTasks.ps1")

    assert '$sourceRestore = Join-Path $root "Restore-OrderPortal.ps1"' in installer
    assert "Source = $sourceRestore" in installer
    assert 'Relative = "Restore-OrderPortal.ps1"' in installer
    assert "Copy-Item -LiteralPath $sourceRestore" in installer
    assert (
        '-Destination (Join-Path $staging "Restore-OrderPortal.ps1")'
        in installer
    )
    assert "$currentHash -cne [string]$sourceFile.Sha256" in installer
    assert "$copiedHash -cne [string]$sourceFile.Sha256" in installer
    assert "Write-RuntimeManifest -Root $staging" in installer
    assert "Assert-ProtectedRuntimeTreeAcl -Root $staging" in installer
    assert "& $powerShell -NoProfile -NonInteractive" in installer
    assert "& powershell.exe" not in installer


def test_restore_rejects_checkout_and_runtime_dependency_injection() -> None:
    restore = _read("Restore-OrderPortal.ps1")
    runtime = (
        "C:\\ProgramData\\Daiyujin\\Companies\\daiyujin-public-pilot\\"
        "precision-tools\\backup-runtime"
    )

    assert runtime in restore
    assert "$scriptDirectory = [IO.Path]::GetFullPath($PSScriptRoot)" in restore
    assert "Restore may run only from the fixed protected runtime bundle" in restore
    assert "Assert-ProtectedRuntimeBundle -Root $RuntimeBundleRoot" in restore
    assert "Protected restore runtime file set differs from its manifest" in restore
    assert "Protected restore runtime hash mismatch: $relative" in restore
    assert "$runtimeLease = [IO.File]::Open(" in restore
    assert "[IO.FileShare]::Read" in restore
    assert (
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        in restore
    )
    assert (
        "Restore must run under the fixed Windows PowerShell executable"
        in restore
    )

    assert 'Join-Path $RuntimeBundleRoot "backend\\scripts"' in restore
    assert "Restore PythonExe must use the exact protected runtime interpreter" in restore
    assert "Select-String" not in restore
    assert 'Join-Path $ProjectRoot ".venv\\Scripts\\python.exe"' not in restore
    assert 'Join-Path $BackendRoot ".venv\\Scripts\\python.exe"' not in restore
    assert restore.count('"-I", "-B"') == 4
    for name in (
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "PYTHONUSERBASE",
        "PYTHONINSPECT",
    ):
        assert f'"{name}"' in restore


def test_restore_sources_secret_only_from_protected_csv_and_cleans_process() -> None:
    restore = _read("Restore-OrderPortal.ps1")

    assert "daiyujin-fresh-pc-secrets.csv" in restore
    assert "Assert-ProtectedSecretsCsvAcl -Path $SecretsCsvPath" in restore
    assert '"PRECISION_TOOLS_BACKUP_PASSWORD"' in restore
    assert "Get-ProtectedBackupPassword -Path $SecretsCsvPath" in restore
    assert "Inherited backup password environment input is rejected" in restore
    assert (
        '"ORDER_PORTAL_BACKUP_PASSWORD",\n'
        "        $backupPassword,\n"
        "        [EnvironmentVariableTarget]::Process"
        in restore
    )
    assert "Remove-Item Env:ORDER_PORTAL_BACKUP_PASSWORD" in restore
    assert "Protected restore password environment cleanup failed" in restore
    assert "-p$backupPassword" not in restore
    assert "--password" not in restore


def test_live_restore_requires_exact_confirmation_and_keeps_transaction_guards() -> None:
    restore = _read("Restore-OrderPortal.ps1")

    assert '$Confirmation -cne "RESTORE_ORDER_PORTAL_TRANSACTION"' in restore
    assert "Plan only. Re-run with -Confirmation " in restore
    assert "Assert-ApprovedWritersStopped" in restore
    assert "New-PreRestoreBackup" in restore
    assert "Prepare-DatabaseRestore" in restore
    assert "Commit-DatabaseRestore" in restore
    assert "Rollback-DatabaseRestore" in restore
    assert "Rollback-DirectoryRestores" in restore
    assert "[IO.File]::Replace" in restore
    assert "Refusing to overwrite an existing protected archive" in restore
    assert '"--expected-sha256", $ExpectedSha256' in restore
