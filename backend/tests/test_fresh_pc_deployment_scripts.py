from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


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
    assert 'listenerOwner.Sid -ne "S-1-5-19"' in source
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


def test_protected_backup_tasks_do_not_put_secret_on_command_line() -> None:
    wrapper = _read("Invoke-PrecisionToolsProtectedBackup.ps1")
    installer = _read("Install-PrecisionToolsBackupTasks.ps1")
    backup = _read("Backup-OrderPortal.ps1")

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
    assert '"t", $ZipPath, "-p$password", "-y"' in backup
    assert "7-Zip archive verification" in backup


def test_exchange_rate_task_can_run_without_interactive_logon() -> None:
    source = _read("Install-Exchange-Rate-Task.ps1")

    assert "[switch]$RunAsSystem" in source
    assert '-UserId "SYSTEM"' in source
    assert "ServiceAccount" in source
    assert "An unowned scheduled task" in source
    assert "Exchange-rate scheduled task verification failed" in source
    assert "INSTALL_EXCHANGE_RATE_TASK" in source
    assert 'if ($Confirmation -cne "INSTALL_EXCHANGE_RATE_TASK")' in source
    assert "requires -RunAsSystem" in source


def test_precision_tools_production_dependencies_are_locked() -> None:
    requirements = _read("backend/requirements.lock")

    package_lines = [
        line for line in requirements.splitlines() if line and not line.startswith("#")
    ]
    assert package_lines
    assert all("==" in line for line in package_lines)
    assert "Flask==3.1.3" in requirements
    assert "SQLAlchemy==2.0.51" in requirements


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
    assert "dyj_tools_customer_company_code" in portal_route
    assert "'brand'" in portal_route
    assert "DYJ_TOOLS_CUSTOMER_COMPANY_CODE" in plugin
    assert ": 'daiyujin'" in plugin
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
