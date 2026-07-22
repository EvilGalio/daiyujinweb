[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$BackendPython = "",
    [string]$SevenZipPath = "C:\Program Files\7-Zip\7z.exe",
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [string]$Confirmation = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Quote-Argument {
    param([string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Resolve-PrincipalSid {
    param([string]$UserId)
    try {
        if ($UserId -match "^S-\d-") {
            return [Security.Principal.SecurityIdentifier]::new($UserId).Value
        }
        return [Security.Principal.NTAccount]::new($UserId).Translate(
            [Security.Principal.SecurityIdentifier]
        ).Value
    }
    catch {
        return ""
    }
}

if (-not (Test-Administrator)) {
    throw "Precision Tools backup task installation requires elevated PowerShell"
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $BackendPython = Join-Path $root ".venv\Scripts\python.exe"
}
$wrapper = Join-Path $root "Invoke-PrecisionToolsProtectedBackup.ps1"
foreach ($path in @($BackendPython, $SevenZipPath, $wrapper, $SecretsCsvPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required Precision Tools backup task input was not found: $path"
    }
}

Write-Host "Precision Tools protected backup task plan"
Write-Host "  Daily: 02:30"
Write-Host "  Weekly: Sunday 03:00"
Write-Host "  Principal: SYSTEM"
Write-Host "  Secret source: protected external CSV"
if ($Confirmation -ne "INSTALL_PRECISION_TOOLS_BACKUP_TASKS") {
    Write-Host "Plan only. Re-run with -Confirmation INSTALL_PRECISION_TOOLS_BACKUP_TASKS"
    exit 0
}

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $wrapper `
    -Mode Daily `
    -ProjectRoot $root `
    -BackendPython ([IO.Path]::GetFullPath($BackendPython)) `
    -SevenZipPath ([IO.Path]::GetFullPath($SevenZipPath)) `
    -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
if ($LASTEXITCODE -ne 0) {
    throw "Protected backup smoke test failed"
}

$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
    -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable `
    -MultipleInstances IgnoreNew -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$taskPlans = @(
    [pscustomobject]@{
        Name = "Daiyujin Precision Tools Daily Backup"
        Mode = "Daily"
        Trigger = New-ScheduledTaskTrigger -Daily -At 2:30AM
    },
    [pscustomobject]@{
        Name = "Daiyujin Precision Tools Weekly Backup"
        Mode = "Weekly"
        Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3:00AM
    }
)
foreach ($plan in $taskPlans) {
    $arguments = @(
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-Argument $wrapper),
        "-Mode", $plan.Mode,
        "-ProjectRoot", (Quote-Argument $root),
        "-BackendPython", (Quote-Argument ([IO.Path]::GetFullPath($BackendPython))),
        "-SevenZipPath", (Quote-Argument ([IO.Path]::GetFullPath($SevenZipPath))),
        "-SecretsCsvPath", (Quote-Argument ([IO.Path]::GetFullPath($SecretsCsvPath)))
    ) -join " "
    $expectedTriggerClass = if ($plan.Mode -eq "Daily") {
        "MSFT_TaskDailyTrigger"
    }
    else {
        "MSFT_TaskWeeklyTrigger"
    }
    $existing = Get-ScheduledTask -TaskName $plan.Name -TaskPath "\" `
        -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        $existingActions = @($existing.Actions)
        $existingTriggers = @($existing.Triggers)
        $knownTask = (
            (Resolve-PrincipalSid ([string]$existing.Principal.UserId)) -eq `
                "S-1-5-18" -and
            $existingActions.Count -eq 1 -and
            [string]$existingActions[0].Execute -eq $powerShell -and
            [string]$existingActions[0].WorkingDirectory -eq $root -and
            [string]$existingActions[0].Arguments -eq $arguments -and
            $existingTriggers.Count -eq 1 -and
            [string]$existingTriggers[0].CimClass.CimClassName -eq `
                $expectedTriggerClass
        )
        if (-not $knownTask) {
            throw "An unowned scheduled task uses the backup task name: $($plan.Name)"
        }
        if ([string]$existing.State -eq "Running") {
            throw "The approved backup task is running; retry after it finishes: $($plan.Name)"
        }
    }
    $action = New-ScheduledTaskAction -Execute $powerShell `
        -Argument $arguments -WorkingDirectory $root
    Register-ScheduledTask -TaskName $plan.Name -Action $action `
        -Trigger $plan.Trigger -Principal $principal -Settings $settings `
        -Description "Creates an encrypted Precision Tools backup without an interactive login." `
        -Force | Out-Null
    Enable-ScheduledTask -TaskName $plan.Name | Out-Null
    $installed = Get-ScheduledTask -TaskName $plan.Name -ErrorAction Stop
    $installedActions = @($installed.Actions)
    $installedTriggers = @($installed.Triggers)
    if (
        (Resolve-PrincipalSid ([string]$installed.Principal.UserId)) -ne `
            "S-1-5-18" -or
        $installedActions.Count -ne 1 -or
        [string]$installedActions[0].Execute -ne $powerShell -or
        [string]$installedActions[0].WorkingDirectory -ne $root -or
        [string]$installedActions[0].Arguments -notlike "*$wrapper*" -or
        [string]$installedActions[0].Arguments -notlike "*-Mode $($plan.Mode)*" -or
        [string]$installedActions[0].Arguments -notlike "*$SecretsCsvPath*" -or
        $installedTriggers.Count -ne 1 -or
        [string]$installedTriggers[0].CimClass.CimClassName -ne $expectedTriggerClass
    ) {
        throw "Protected backup task verification failed: $($plan.Name)"
    }
}

$latestBackup = Get-ChildItem -LiteralPath (
    Join-Path $root "local_backups\order_portal\daily"
) -Filter "order-portal-daily-*.zip" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if ($null -eq $latestBackup) {
    throw "Protected backup smoke test did not create a daily archive"
}
Write-Host "Precision Tools protected backup tasks: READY"
Write-Host "Latest smoke-test backup: $($latestBackup.FullName)"
