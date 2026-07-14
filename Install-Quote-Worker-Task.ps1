[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$BackendPython = "",
    [string]$OccPython = "",
    [string]$TaskName = "Daiyujin Quote Worker",
    [switch]$RunAtStartupAsSystem,
    [switch]$Remove
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task: $TaskName"
    }
    else {
        Write-Host "Scheduled task is already absent: $TaskName"
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$RunWorker = Join-Path $ProjectRoot "run-quote-worker.ps1"
$RuntimeLog = Join-Path $ProjectRoot "quote-worker-scheduled.log"

if (-not (Test-Path -LiteralPath $RunWorker -PathType Leaf)) {
    throw "Quote worker launcher not found: $RunWorker"
}
foreach ($runtime in @($BackendPython, $OccPython)) {
    if ([string]::IsNullOrWhiteSpace($runtime) -or -not (Test-Path -LiteralPath $runtime -PathType Leaf)) {
        throw "Both BackendPython and OccPython must be usable absolute paths."
    }
}

function Quote-Argument {
    param([string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$argumentLine = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-Argument $RunWorker),
    "-BackendPython", (Quote-Argument $BackendPython),
    "-OccPython", (Quote-Argument $OccPython),
    "-LogPath", (Quote-Argument $RuntimeLog)
) -join " "

$action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument $argumentLine `
    -WorkingDirectory $ProjectRoot

if ($RunAtStartupAsSystem) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "RunAtStartupAsSystem requires an elevated PowerShell session."
    }
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest
}
else {
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal `
        -UserId $userId `
        -LogonType Interactive `
        -RunLevel Limited
}
$settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Runs the Daiyujin asynchronous CAD quote worker after Windows starts." `
    -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName | Out-Null

Write-Host "PASS: Scheduled task registered: $TaskName"
Write-Host "ProjectRoot: $ProjectRoot"
Write-Host "Launcher:    $RunWorker"
if ($RunAtStartupAsSystem) {
    Write-Host "Trigger:     Windows startup as SYSTEM"
}
else {
    Write-Host "Trigger:     User logon for $userId"
}
