from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def _assert_synchronized_allow_mask(source: str, right: str) -> None:
    assert re.search(
        (
            rf"\[Security\.AccessControl\.FileSystemRights\]::{right}\s+-bor\s+"
            r"\[Security\.AccessControl\.FileSystemRights\]::Synchronize"
        ),
        source,
    )


def test_empty_fresh_pc_seed_uses_generated_admin_password() -> None:
    seed = _read("backend/scripts/seed_data.py")
    verify = _read("backend/scripts/verify_fresh_pc_seed.py")
    installer = _read("Initialize-PrecisionToolsFreshPc.ps1")

    assert "PRECISION_TOOLS_ADMIN_PASSWORD" in seed
    assert "PRECISION_TOOLS_ALLOW_INSECURE_DEV_SEED" in seed
    assert "PRECISION_TOOLS_ADMIN_PASSWORD is required" in seed
    assert "change-me-before-production" in verify
    assert "check_password_hash" in verify
    assert "INITIALIZE_PRECISION_TOOLS_EMPTY_DATA" in installer
    assert "NEXTGEN_LEGACY_HANDOFF_SECRET" in installer
    assert "http://127.0.0.1:5400/api/v2" in installer
    assert '"NEXTGEN_COMPANY_CODE=daiyujin"' in installer
    assert (
        '"NEXTGEN_CUSTOMER_PORTAL_URL=https://portal.daiyujin.dpdns.org"'
        in installer
    )
    assert '"PRECISION_TOOLS_BACKUP_PASSWORD"' in installer
    assert "https://mfg-solution.com" in installer
    assert "https://www.mfg-solution.com" in installer
    assert "http://127.0.0.1:5500" not in installer
    assert '"QUOTE_ASYNC_ARCHIVES_ENABLED=0"' in installer
    assert '"QUOTE_ASYNC_ARCHIVES_ENABLED=1"' not in installer
    assert (
        'if ($Confirmation -cne "INITIALIZE_PRECISION_TOOLS_EMPTY_DATA")'
        in installer
    )
    assert "No existing database or upload will be deleted" in installer
    assert "$runtimeDataRoots" in installer
    assert '"private\\order_media"' in installer
    assert '"private\\nextgen_handoff"' in installer
    assert '"uploads"' in installer
    assert '"static\\thumbnails"' in installer
    assert '"static\\stl"' in installer
    assert "$existingRuntimeItems.Count -gt 0" in installer
    assert "ReferenceDataRoot" in installer
    assert "materialize_reference_data.py" in installer
    assert "--reference-root" in installer
    assert "ValidateSecretsOnly" in installer
    assert "--reference-root" in verify


def test_precision_tools_api_task_is_loopback_low_privilege_and_restartable() -> None:
    source = _read("Install-PrecisionToolsApiTask.ps1")
    acl = _read("Set-PrecisionToolsRuntimeAcl.ps1")

    assert 'TaskName = "Daiyujin Precision Tools API"' in source
    assert 'ApiPort = 5000' in source
    assert 'New-ScheduledTaskTrigger -AtStartup' in source
    assert '-UserId "S-1-5-19"' in source
    assert "-RunLevel Limited" in source
    assert "GetOwnerSid" in source
    assert '[string]$owner.Sid -ne "S-1-5-19"' in source
    assert "LocalService runtime ACL" in acl
    assert 'SecurityIdentifier]::new("S-1-5-19")' in acl
    assert 'Join-Path $backendRoot "private\\order_media"' in acl
    assert "FileSystemRights]::Modify" in acl
    assert "ACL inheritance must be disabled" in acl
    assert "unexpected Windows principal" in acl
    assert "must grant only Modify to the current operator" in acl
    assert "MultipleInstances IgnoreNew" in source
    assert "RestartCount 10" in source
    assert "http://127.0.0.1:$ApiPort/api/health" in source
    assert "INSTALL_PRECISION_TOOLS_API_TASK" in source


def test_exact_windows_allow_acl_masks_include_automatic_synchronize() -> None:
    runtime_acl = _read("Set-PrecisionToolsRuntimeAcl.ps1")
    backup_installer = _read("Install-PrecisionToolsBackupTasks.ps1")
    backup_wrapper = _read("Invoke-PrecisionToolsProtectedBackup.ps1")
    backup = _read("Backup-OrderPortal.ps1")
    restore = _read("Restore-OrderPortal.ps1")

    secrets_acl = runtime_acl.split(
        "function Assert-ProtectedSecretsCsvAcl",
        1,
    )[1]
    _assert_synchronized_allow_mask(secrets_acl, "Modify")

    _assert_synchronized_allow_mask(backup_installer, "Modify")
    _assert_synchronized_allow_mask(backup_installer, "Read")
    _assert_synchronized_allow_mask(backup_wrapper, "Modify")
    _assert_synchronized_allow_mask(backup_wrapper, "Read")

    output_acl = backup.split(
        "function Assert-ProtectedBackupOutputItemAcl",
        1,
    )[1].split(
        "function Set-ProtectedBackupOutputItemAcl",
        1,
    )[0]
    _assert_synchronized_allow_mask(output_acl, "ReadAndExecute")
    _assert_synchronized_allow_mask(output_acl, "Read")

    environment_acl = restore.split(
        "function Assert-ProtectedEnvironmentFileAcl",
        1,
    )[1].split(
        "function Get-EnvironmentSetting",
        1,
    )[0]
    _assert_synchronized_allow_mask(environment_acl, "Read")

    restore_secrets_acl = restore.split(
        "function Assert-ProtectedSecretsCsvAcl",
        1,
    )[1].split(
        "function Get-ProtectedBackupPassword",
        1,
    )[0]
    _assert_synchronized_allow_mask(restore_secrets_acl, "Modify")


def test_windows_allow_ace_round_trip_adds_only_synchronize() -> None:
    powershell = shutil.which("powershell.exe")
    if powershell is None:
        pytest.skip("Windows PowerShell is unavailable")
    command = r"""
$sid = [Security.Principal.SecurityIdentifier]::new("S-1-5-19")
$allow = [Security.AccessControl.AccessControlType]::Allow
$inheritance = (
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
)
foreach ($base in @(
    [Security.AccessControl.FileSystemRights]::Modify,
    [Security.AccessControl.FileSystemRights]::Read,
    [Security.AccessControl.FileSystemRights]::ReadAndExecute
)) {
    $approved = (
        $base -bor [Security.AccessControl.FileSystemRights]::Synchronize
    )
    foreach ($directoryRule in @($false, $true)) {
        $rule = if ($directoryRule) {
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                $base,
                $inheritance,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        }
        else {
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                $base,
                $allow
            )
        }
        if ([int64]$rule.FileSystemRights -ne [int64]$approved) {
            exit 1
        }
    }
}
exit 0
"""
    completed = subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert completed.returncode == 0, completed.stderr


def test_quote_worker_startup_uses_local_service_and_protected_runtime_logs() -> None:
    installer = _read("Install-Quote-Worker-Task.ps1")
    updater = _read("Update-Company-PC.ps1")

    assert '[Alias("RunAtStartupAsSystem")]' in installer
    assert "RunAtStartupAsLocalService" in installer
    assert '-UserId "S-1-5-19"' in installer
    assert "-RunLevel Limited" in installer
    assert '"logs\\quote-worker-scheduled.log"' in installer
    assert "GetOwnerSid" in installer
    assert "An unowned scheduled task" in installer
    assert "RunWorkerTaskAtStartupAsLocalService" in updater
    assert 'Start-ScheduledTask -TaskName $WorkerTaskName' in updater
    assert 'Start-ScheduledTask -TaskName $ApiTaskName' in updater
    assert 'Disable-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\\"' in updater
    assert 'Disable-ScheduledTask -TaskName $ApiTaskName -TaskPath "\\"' in updater
    assert "The production quote worker LocalService task is missing" in updater
    assert "The production Precision Tools API LocalService task is missing" in updater
    api_installer = _read("Install-PrecisionToolsApiTask.ps1")
    assert (
        'if ($Confirmation -cne "INSTALL_PRECISION_TOOLS_API_TASK")'
        in api_installer
    )
    assert "INSTALL_QUOTE_WORKER_TASK" in installer
    assert 'if ($Confirmation -cne "INSTALL_QUOTE_WORKER_TASK")' in installer
    assert "REMOVE_QUOTE_WORKER_TASK" in installer
    assert "requires -RunAtStartupAsLocalService" in installer


def test_quote_worker_task_replacement_is_owned_and_race_safe() -> None:
    installer = _read("Install-Quote-Worker-Task.ps1")

    ownership = installer.split(
        "function Test-OwnedQuoteWorkerTask",
        1,
    )[1].split(
        "function Test-ExpectedWorkerHostProcess",
        1,
    )[0]
    assert "$Task.Description" in ownership
    assert "$Task.Principal.UserId" in ownership
    assert "$actions[0].Execute -eq $powerShell" in ownership
    assert "$actions[0].WorkingDirectory -eq $ProjectRoot" in ownership
    assert "$actions[0].Arguments -eq $argumentLine" in ownership

    removal = installer.split("if ($Remove) {", 1)[1].split(
        'Write-Host "Precision Tools quote-worker scheduled-task plan"',
        1,
    )[0]
    assert "Test-OwnedQuoteWorkerTask" in removal
    assert "Wait-OwnedQuoteWorkerStopped" in removal
    assert "Clear-StaleOwnedWorkerState -OwnedTaskVerified" in removal
    assert "-like" not in removal

    replacement = installer.split(
        '$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\\"',
    )[-1]
    assert "Test-OwnedQuoteWorkerTask" in replacement
    assert "Wait-OwnedQuoteWorkerStopped" in replacement
    assert "Clear-StaleOwnedWorkerState -OwnedTaskVerified" in replacement
    assert "$startRequestedUtc = [DateTime]::UtcNow" in replacement
    assert "$candidate.CreationDate" in replacement
    assert "Test-ExpectedWorkerHostProcess" in replacement
    assert '[string]$stableTask.State -ne "Running"' in replacement
    assert "did not remain running" in replacement


def test_fresh_pc_mutations_are_contained_and_reparse_checked() -> None:
    initializer = _read("Initialize-PrecisionToolsFreshPc.ps1")
    acl = _read("Set-PrecisionToolsRuntimeAcl.ps1")

    assert "Assert-PrecisionToolsBootstrapSource" in initializer
    assert "-CommonPath $environmentCommon" in initializer
    assert "Assert-PrecisionToolsPathContained" in initializer
    assert "-ContainmentRoot $backendRoot" in initializer
    assert "Assert-PrecisionToolsNoReparsePoints -Path $ReferenceDataRoot" in initializer
    cleanup = initializer.split("if (-not $initializationSucceeded)", 1)[1]
    assert 'Label "Precision Tools cleanup data directory"' in cleanup
    assert "Assert-PrecisionToolsNoReparsePoints -Path $envPath" in cleanup

    runtime_acl_writer = acl.split("function Set-RuntimeDirectoryAcl", 1)[1].split(
        "function Assert-ProtectedSecretsCsvAcl",
        1,
    )[0]
    assert "Assert-PrecisionToolsTrustedMutationAncestors" in runtime_acl_writer
    assert runtime_acl_writer.count("Assert-PrecisionToolsPathContained") >= 2
    assert "New-Item -ItemType Directory -Path $resolved" in runtime_acl_writer
    assert "Set-Acl -LiteralPath $resolved" in runtime_acl_writer


def test_protected_backup_tasks_do_not_put_secret_on_command_line() -> None:
    wrapper = _read("Invoke-PrecisionToolsProtectedBackup.ps1")
    installer = _read("Install-PrecisionToolsBackupTasks.ps1")
    backup = _read("Backup-OrderPortal.ps1")
    restore = _read("Restore-OrderPortal.ps1")

    assert '"PRECISION_TOOLS_BACKUP_PASSWORD"' in wrapper
    assert "EnvironmentVariableTarget]::Process" in wrapper
    assert "Remove-Item Env:ORDER_PORTAL_BACKUP_PASSWORD" in wrapper
    assert '-UserId "SYSTEM"' in installer
    assert "CLOUDFLARE_TUNNEL_TOKEN" not in installer
    assert "PRECISION_TOOLS_BACKUP_PASSWORD" not in installer
    assert "Get-ScheduledTask" in installer
    assert "MSFT_TaskDailyTrigger" in installer
    assert "MSFT_TaskWeeklyTrigger" in installer
    assert "Resolve-PrincipalSid" in installer
    assert '"S-1-5-18"' in installer
    assert "protected_backup_archive.py" in backup
    assert "Protected archive verification" in backup
    assert '"--archive", $ArchivePath' in backup
    assert "-p$password" not in backup
    assert "SevenZipPath" not in backup
    assert "7z.exe" not in backup
    assert "ProtectedWorkRoot" in backup
    assert "fixed Precision Tools backup-work path" in backup
    assert "ProtectedWorkRoot" in restore
    assert "fixed Precision Tools restore-work path" in restore
    assert 'Join-Path (Join-Path $ProjectRoot ".tmp")' not in backup
    assert 'Join-Path (Join-Path $BackupRoot "restore_tests")' not in restore
    external_environment = (
        "C:\\ProgramData\\Daiyujin\\Companies\\daiyujin-public-pilot\\"
        "precision-tools\\production.env"
    )
    assert external_environment in backup
    assert external_environment in restore
    assert external_environment in wrapper
    assert external_environment in installer
    assert "backend\\.env" not in backup
    assert "backend\\.env" not in restore
    assert "Environment restore is disabled" in restore

    protected_runtime = (
        "C:\\ProgramData\\Daiyujin\\Companies\\daiyujin-public-pilot\\"
        "precision-tools\\backup-runtime"
    )
    assert protected_runtime in installer
    assert protected_runtime in wrapper
    assert "bundle-manifest.json" in installer
    assert "bundle-manifest.json" in wrapper
    assert "Get-FileHash" in installer
    assert "Get-FileHash" in wrapper
    assert "Assert-ProtectedRuntimeBundle" in wrapper
    assert "Assert-ExactProtectedFileAcl" in installer
    assert "Assert-ProtectedSecretsCsv" in wrapper
    assert "-WorkingDirectory $runtime" in installer
    assert "-File\", (Quote-Argument $installedWrapper)" in installer
    assert "-BackendPython" not in installer
    assert "python-base" in installer
    assert "Get-TreeItemsWithoutReparse" in installer

    assert "Assert-NoReparseTree -Path $Source" in backup
    assert "exact protected backup runtime interpreter" in backup
    assert "Select-String" not in backup
    assert "anaconda" not in backup.lower()
    assert "miniconda" not in backup.lower()
    assert "New-ImmutableProjectVolumeSnapshot" in backup
    assert "Win32_ShadowCopy" in backup
    assert "Daiyujin.BackupDosDevice" in backup
    assert "DefineDosDevice" in backup
    assert "Assert-NoReparseSnapshotTree" in backup
    assert "Remove-ImmutableProjectVolumeSnapshot" in backup
    assert "Protected backup cleanup failed" in backup
    assert "Initialize-ProtectedBackupOutput" in backup
    assert "grants untrusted mutation rights" in backup
    protected_output = (
        "C:\\ProgramData\\Daiyujin\\Companies\\daiyujin-public-pilot\\"
        "precision-tools\\backup-output\\order_portal"
    )
    assert protected_output in backup
    assert "fixed protected ProgramData output" in restore
    assert (
        "Restore archive must remain inside the protected backup output root"
        in restore
    )
    assert "local_backups" not in backup
    assert "Get-LegacyCandidates" not in backup
    assert "Privileged legacy cleanup is disabled" in backup
    assert "-OperatorSid $OperatorSid" in wrapper
    assert "backend\\private\\nextgen_handoff" in backup
    assert "backend\\private\\nextgen_handoff" in restore
    assert "Remove-ProtectedBackupWorkTree" in backup
    assert (
        "Remove-Item -LiteralPath $RunRoot -Recurse -Force"
        not in backup
    )
    assert 'contract = "daiyujin-public-pilot-precision-tools-backup-v1"' in backup
    assert "New-SnapshotSqliteSource" in backup
    assert '@("-wal", "-shm", "-journal")' in backup
    assert (
        'Join-Path $PayloadRoot "backend\\data\\$(Split-Path -Leaf $sidecar)"'
        not in backup
    )

    assert "--expected-sha256" in restore
    assert "Assert-InternalBackupContract" in restore
    assert '"pre_restore"' in restore
    assert "Assert-ApprovedWritersStopped" in restore
    assert "Assert-ApprovedWriterTaskDefinition" in restore
    assert "An unowned task uses an approved SQLite writer task name" in restore
    assert "Disable-ApprovedWriterTasks" in restore
    assert "Get-CimInstance -ClassName Win32_Process" in restore
    assert "[IO.FileShare]::None" in restore
    assert "[IO.File]::Replace" in restore
    assert "Rollback-DatabaseRestore" in restore
    assert "Rollback-DirectoryRestores" in restore
    assert "Remove-ProtectedRestoreWorkTree" in restore
    assert (
        "Remove-Item -LiteralPath $RestoreRoot -Recurse -Force"
        not in restore
    )


def test_company_updater_uses_installed_protected_backup_contract() -> None:
    updater = _read("Update-Company-PC.ps1")
    wrapper = _read("Invoke-PrecisionToolsProtectedBackup.ps1")
    backup_call = updater.split(
        "function Backup-OrderPortalBeforeUpdate",
        1,
    )[1].split(
        "function Pull-FrameworkChanges",
        1,
    )[0]

    protected_runtime = (
        "C:\\ProgramData\\Daiyujin\\Companies\\daiyujin-public-pilot\\"
        "precision-tools\\backup-runtime"
    )
    protected_output = (
        "C:\\ProgramData\\Daiyujin\\Companies\\daiyujin-public-pilot\\"
        "precision-tools\\backup-output\\order_portal"
    )
    protected_secrets = (
        "C:\\ProgramData\\Daiyujin\\Operator\\"
        "daiyujin-fresh-pc-secrets.csv"
    )

    assert protected_runtime in updater
    assert protected_output in updater
    assert protected_secrets in updater
    assert "Invoke-PrecisionToolsProtectedBackup.ps1" in backup_call
    assert 'Join-Path $ProjectRoot "Backup-OrderPortal.ps1"' not in backup_call
    assert '"-File", $protectedBackupWrapper' in backup_call
    assert '"-RuntimeBundleRoot", $ProtectedBackupRuntimeRoot' in backup_call
    assert '"-EnvironmentFile", $EnvFile' in backup_call
    assert '"-SecretsCsvPath", $ProtectedBackupSecretsCsv' in backup_call
    assert '"-OperatorSid", $OperatorSid' in backup_call
    assert "[Parameter(Mandatory = $true)]" in backup_call
    assert '"-BackupRoot"' not in backup_call
    assert "Backup-OrderPortalBeforeUpdate -OperatorSid $operatorSid" in updater

    assert protected_runtime in wrapper
    assert protected_output in wrapper
    assert protected_secrets in wrapper
    assert "-OperatorSid $OperatorSid -BackupRoot $backupOutput" in wrapper


def test_quote_jobs_are_only_captured_inside_the_encrypted_backup() -> None:
    updater = _read("Update-Company-PC.ps1")
    backup = _read("Backup-OrderPortal.ps1")
    restore = _read("Restore-OrderPortal.ps1")

    assert "function Backup-QuoteJobsBeforeUpdate" not in updater
    assert "local_backups\\quote_jobs" not in updater
    assert "$QuoteBackupRoot" not in updater
    assert '"job-storage"' not in updater
    assert 'Join-Path $DataRoot "quote_jobs.db"' in backup
    assert '-DatabaseName "quote_jobs.db"' in backup
    assert 'Join-Path $PayloadRoot "backend\\data\\quote_jobs.db"' in backup
    assert '"quote-jobs-db-meta.json"' in backup
    assert 'quote_jobs_db_path = "backend/data/quote_jobs.db"' in backup
    assert "quote_jobs_db_included" in backup
    assert "quote_job_storage_file_count" in backup
    assert "function Assert-QuoteRuntimeBackupCoverage" in backup
    assert '"QUOTE_JOBS_DB_PATH"' in backup
    assert '"QUOTE_JOB_STORAGE_ROOT"' in backup
    assert "fixed path covered by the" in backup
    assert '@("backend\\uploads", "backend\\uploads")' in backup
    assert "Compress-ProtectedArchive -SourceFolder $PayloadRoot" in backup
    assert "$null -eq $quoteJobsSnapshot -and $quoteStorageHasItems" in backup
    assert "refusing an incomplete protected backup" in backup
    assert '"quote_analysis_jobs"' in restore
    assert '"quote_analysis_parts"' in restore
    assert '"quote_worker_heartbeats"' in restore
    assert '"backend\\data\\quote_jobs.db"' in restore
    assert "-TargetDb $QuoteJobsDbPath" in restore
    assert '-DatabaseKind "quote_jobs"' in restore
    assert "$quoteJobsDatabaseState" in restore
    assert "function Assert-QuoteRuntimeRestoreCompatibility" in restore
    assert "refusing a mixed restore" in restore
    assert "$writerTasksDisabled -and $rollbackFailed" in restore
    assert "remain disabled" in restore
    writer_probe = restore.split(
        "function Assert-ApprovedWritersStopped",
        1,
    )[1].split(
        "function Disable-ApprovedWriterTasks",
        1,
    )[0]
    assert '"$DbPath-journal"' in writer_probe
    assert '"$QuoteJobsDbPath-journal"' in writer_probe
    database_prepare = restore.split(
        "function Prepare-DatabaseRestore",
        1,
    )[1].split(
        "function Commit-DatabaseRestore",
        1,
    )[0]
    assert '@("-wal", "-shm", "-journal")' in database_prepare


def test_exchange_rate_task_runs_as_local_service_without_interactive_logon() -> None:
    source = _read("Install-Exchange-Rate-Task.ps1")

    assert "[switch]$RunAsLocalService" in source
    assert '-UserId "S-1-5-19"' in source
    assert "ServiceAccount" in source
    assert "An unowned scheduled task" in source
    assert "Exchange-rate scheduled task verification failed" in source
    assert "INSTALL_EXCHANGE_RATE_TASK" in source
    assert 'if ($Confirmation -cne "INSTALL_EXCHANGE_RATE_TASK")' in source
    assert "requires -RunAsLocalService" in source


def test_precision_tools_production_dependencies_are_locked() -> None:
    requirements = _read("backend/requirements.lock")
    updater = _read("Update-Company-PC.ps1")
    archive = _read("backend/scripts/enable_archive_uploads.ps1")

    package_lines = [
        line for line in requirements.splitlines() if line and not line.startswith("#")
    ]
    assert package_lines
    assert all("==" in line for line in package_lines)
    assert "Flask==3.1.3" in requirements
    assert "SQLAlchemy==2.0.51" in requirements
    for installer in (updater, archive):
        assert 'Join-Path $BackendRoot "requirements.lock"' in installer
        assert 'Join-Path $BackendRoot "requirements.txt"' not in installer


def test_customer_portal_defaults_to_server_selected_daiyujin_company() -> None:
    plugin = _read("daiyujin-tools/daiyujin-tools.php")
    quote_js = _read("js/quote.js")
    packaged_quote_js = _read("daiyujin-tools/assets/js/quote.js")
    pricing = _read("backend/services/pricing.py")
    portal_route = plugin.split("function dyj_tools_portal_route", 1)[1]
    portal_route = portal_route.split("function dyj_tools_instant_quote_url", 1)[0]

    expected_portal = "https://portal.daiyujin.dpdns.org"
    assert expected_portal in plugin
    assert expected_portal in quote_js
    assert expected_portal in packaged_quote_js
    assert "dyj_tools_customer_company_code" not in portal_route
    assert "'brand'" not in portal_route
    assert "DYJ_TOOLS_CUSTOMER_COMPANY_CODE" not in plugin
    assert '"file_receipt": payload.get("file_receipt")' in pricing


def test_api_launcher_preserves_only_explicit_https_cors_origins() -> None:
    launcher = _read("run-api.ps1")

    assert "IsNullOrWhiteSpace($env:ALLOWED_ORIGINS)" in launcher
    assert "$validatedAllowedOrigins" in launcher
    assert '"https://mfg-solution.com"' in launcher
    assert '"https://www.mfg-solution.com"' in launcher
    assert '"https://gcnov.com"' in launcher
    assert '"https://gcindus.com"' in launcher
    assert "http://127.0.0.1:5500" not in launcher
    assert "http://daiyujin.dpdns.org" not in launcher
    assert "explicit HTTPS origins" in launcher
    assert '$origin.Contains("*")' in launcher
    assert "$parsedOrigin.IsLoopback" in launcher
    assert "[UriPartial]::Authority" in launcher
