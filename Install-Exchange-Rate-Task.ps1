param(
    [string]$TaskName = "Daiyujin Exchange Rate Update",
    [string]$At = "09:00"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Join-Path $ProjectRoot "run-exchange-rate-update.ps1"

if (-not (Test-Path -LiteralPath $RunScript)) {
    throw "Run script not found: $RunScript"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`""

$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Refresh Daiyujin quote/freight exchange rates from the public FX API." `
    -Force | Out-Null

Write-Host "Scheduled task installed: $TaskName at $At daily" -ForegroundColor Green
Write-Host "Run script: $RunScript"
