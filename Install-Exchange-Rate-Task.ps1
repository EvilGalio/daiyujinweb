param(
    [string]$TaskName = "Daiyujin Exchange Rate Update",
    [string]$At = "09:00",
    [switch]$RunAsSystem
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Join-Path $ProjectRoot "run-exchange-rate-update.ps1"

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

if (-not (Test-Path -LiteralPath $RunScript)) {
    throw "Run script not found: $RunScript"
}

$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$argumentLine = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$RunScript`""
$action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument $argumentLine `
    -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$registration = @{
    TaskName = $TaskName
    Action = $action
    Trigger = $trigger
    Settings = $settings
    Description = "Refresh Daiyujin quote/freight exchange rates from the public FX API."
    Force = $true
}
if ($RunAsSystem) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principalCheck.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )) {
        throw "RunAsSystem requires an elevated PowerShell session."
    }
    $registration["Principal"] = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $approvedExistingPrincipals = @(
        "S-1-5-18",
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    )
}
else {
    $approvedExistingPrincipals = @(
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    )
}

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    $existingActions = @($existing.Actions)
    $existingTriggers = @($existing.Triggers)
    $knownTask = (
        (Resolve-PrincipalSid ([string]$existing.Principal.UserId)) -in `
            $approvedExistingPrincipals -and
        $existingActions.Count -eq 1 -and
        [string]$existingActions[0].Execute -eq $powerShell -and
        [string]$existingActions[0].WorkingDirectory -eq $ProjectRoot -and
        [string]$existingActions[0].Arguments -eq $argumentLine -and
        $existingTriggers.Count -eq 1 -and
        [string]$existingTriggers[0].CimClass.CimClassName -eq `
            "MSFT_TaskDailyTrigger"
    )
    if (-not $knownTask) {
        throw "An unowned scheduled task already uses the exchange-rate task name"
    }
    if ([string]$existing.State -eq "Running") {
        throw "The exchange-rate task is running; retry after it finishes"
    }
}
Register-ScheduledTask @registration | Out-Null

$installed = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction Stop
$installedActions = @($installed.Actions)
$installedTriggers = @($installed.Triggers)
if (
    $installedActions.Count -ne 1 -or
    [string]$installedActions[0].Execute -ne $powerShell -or
    [string]$installedActions[0].WorkingDirectory -ne $ProjectRoot -or
    [string]$installedActions[0].Arguments -ne $argumentLine -or
    $installedTriggers.Count -ne 1 -or
    [string]$installedTriggers[0].CimClass.CimClassName -ne `
        "MSFT_TaskDailyTrigger"
) {
    throw "Exchange-rate scheduled task verification failed"
}
if (
    $RunAsSystem -and
    (Resolve-PrincipalSid ([string]$installed.Principal.UserId)) -ne `
        "S-1-5-18"
) {
    throw "Exchange-rate task is not registered as SYSTEM"
}

Write-Host "Scheduled task installed: $TaskName at $At daily" -ForegroundColor Green
Write-Host "Run script: $RunScript"
if ($RunAsSystem) {
    Write-Host "Principal: SYSTEM"
}
