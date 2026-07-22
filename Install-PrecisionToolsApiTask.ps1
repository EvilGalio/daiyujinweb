[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$BackendPython = "",
    [string]$OccPython = (
        "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
    ),
    [string]$TaskName = "Daiyujin Precision Tools API",
    [int]$ApiPort = 5000,
    [string]$RuntimeRoot = (
        "C:\ProgramData\Daiyujin\PrecisionTools\runtime"
    ),
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
    throw "Precision Tools API task installation must run from elevated PowerShell"
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $BackendPython = Join-Path $root ".venv\Scripts\python.exe"
}
$launcher = Join-Path $root "run-api.ps1"
$database = Join-Path $root "backend\data\daiyujin.db"
$environment = Join-Path $root "backend\.env"
$aclScript = Join-Path $root "Set-PrecisionToolsRuntimeAcl.ps1"
$runtimeTemp = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) "temp"
foreach ($path in @(
    $BackendPython,
    $OccPython,
    $launcher,
    $database,
    $environment,
    $aclScript,
    $SecretsCsvPath
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required Precision Tools runtime file not found: $path"
    }
}
if ($ApiPort -ne 5000) {
    throw "Precision Tools public API contract requires loopback port 5000"
}

Write-Host "Precision Tools API scheduled-task plan"
Write-Host "  Task: $TaskName"
Write-Host "  Origin: http://127.0.0.1:$ApiPort"
Write-Host "  Principal: LocalService (S-1-5-19)"
if ($Confirmation -ne "INSTALL_PRECISION_TOOLS_API_TASK") {
    Write-Host "Plan only. Re-run with -Confirmation INSTALL_PRECISION_TOOLS_API_TASK"
    exit 0
}

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $aclScript `
    -ProjectRoot $root `
    -OccPython ([IO.Path]::GetFullPath($OccPython)) `
    -RuntimeRoot ([IO.Path]::GetFullPath($RuntimeRoot)) `
    -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools LocalService runtime ACL configuration failed"
}

& $BackendPython -B -c "import flask, sqlalchemy, waitress"
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools backend dependencies cannot be imported"
}
& $OccPython -B -c "from OCC.Core.STEPControl import STEPControl_Reader"
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools OCC runtime cannot be imported"
}

$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-Argument $launcher),
    "-BackendPython", (Quote-Argument ([IO.Path]::GetFullPath($BackendPython))),
    "-OccPython", (Quote-Argument ([IO.Path]::GetFullPath($OccPython))),
    "-RuntimeTempRoot", (Quote-Argument $runtimeTemp),
    "-ApiPort", $ApiPort
) -join " "
$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    $existingActions = @($existing.Actions)
    $existingPrincipal = Resolve-PrincipalSid (
        [string]$existing.Principal.UserId
    )
    $knownTask = (
        $existingActions.Count -eq 1 -and
        $existingPrincipal -in @("S-1-5-18", "S-1-5-19") -and
        [string]$existingActions[0].Execute -eq $powerShell -and
        [string]$existingActions[0].WorkingDirectory -eq $root -and
        [string]$existingActions[0].Arguments -eq $arguments
    )
    if (-not $knownTask) {
        throw "An unowned scheduled task already uses the approved task name"
    }
    if ([string]$existing.State -eq "Running") {
        Stop-ScheduledTask -TaskName $TaskName -TaskPath "\"
    }
}
$listenerDeadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $existingListeners = @(
        Get-NetTCPConnection -LocalPort $ApiPort -State Listen `
            -ErrorAction SilentlyContinue
    )
    if ($existingListeners.Count -eq 0) {
        break
    }
    if ($null -eq $existing) {
        throw "Port 5000 is already owned by a process outside the approved task"
    }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $listenerDeadline)
if ($existingListeners.Count -ne 0) {
    throw "The previous approved API task did not release loopback port 5000"
}
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments `
    -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "S-1-5-19" `
    -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable `
    -MultipleInstances IgnoreNew -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Runs the loopback-only Daiyujin Precision Tools API." `
    -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName -TaskPath "\" | Out-Null
Start-ScheduledTask -TaskName $TaskName -TaskPath "\"

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/health" `
            -TimeoutSec 2
        if (
            $response.error -eq $false -and
            $response.ok -eq $true -and
            $response.service -eq "daiyujin-precision-tools"
        ) {
            $ready = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 1
    }
}
if (-not $ready) {
    throw "Precision Tools API task did not pass loopback health verification"
}
$runningTask = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction Stop
if (
    [string]$runningTask.State -ne "Running" -or
    (Resolve-PrincipalSid ([string]$runningTask.Principal.UserId)) -ne `
        "S-1-5-19"
) {
    throw "Precision Tools API task is not running as LocalService"
}
$listeners = @(
    Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction Stop
)
if ($listeners.Count -ne 1 -or [string]$listeners[0].LocalAddress -ne "127.0.0.1") {
    throw "Precision Tools API must have exactly one loopback listener"
}
$listenerProcess = Get-CimInstance Win32_Process -Filter (
    "ProcessId = {0}" -f [int]$listeners[0].OwningProcess
) -ErrorAction Stop
$listenerOwner = Invoke-CimMethod -InputObject $listenerProcess `
    -MethodName GetOwnerSid -ErrorAction Stop
if (
    [int]$listenerOwner.ReturnValue -ne 0 -or
    [string]$listenerOwner.Sid -ne "S-1-5-19"
) {
    throw "Loopback port 5000 is not owned by LocalService"
}
$actualExecutable = [IO.Path]::GetFullPath([string]$listenerProcess.ExecutablePath)
$expectedExecutable = [IO.Path]::GetFullPath($BackendPython)
if (
    -not $actualExecutable.Equals(
        $expectedExecutable,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    [string]$listenerProcess.CommandLine -notmatch "(?i)waitress" -or
    [string]$listenerProcess.CommandLine -notmatch "(?i)app:app"
) {
    throw "Loopback port 5000 is not owned by the approved Precision Tools runtime"
}
Write-Host "Precision Tools API scheduled task: READY"
Write-Host "Health: http://127.0.0.1:$ApiPort/api/health"
