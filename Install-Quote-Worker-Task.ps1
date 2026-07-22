[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$BackendPython = "",
    [string]$OccPython = "",
    [string]$TaskName = "Daiyujin Quote Worker",
    [Alias("RunAtStartupAsSystem")]
    [switch]$RunAtStartupAsLocalService,
    [string]$RuntimeRoot = (
        "C:\ProgramData\Daiyujin\PrecisionTools\runtime"
    ),
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [switch]$Remove
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
        -ErrorAction SilentlyContinue
    if ($existing) {
        $existingActions = @($existing.Actions)
        $expectedPowerShell = Join-Path $env:SystemRoot `
            "System32\WindowsPowerShell\v1.0\powershell.exe"
        $knownTask = (
            [string]$existing.Description -eq `
                "Runs the Daiyujin asynchronous CAD quote worker after Windows starts." -and
            $existingActions.Count -eq 1 -and
            [string]$existingActions[0].Execute -eq $expectedPowerShell -and
            [string]$existingActions[0].Arguments -like `
                "*-File *run-quote-worker.ps1*"
        )
        if (-not $knownTask) {
            throw "Refusing to remove an unowned scheduled task"
        }
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath "\" `
            -Confirm:$false
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
$RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$RuntimeLog = Join-Path $RuntimeRoot "logs\quote-worker-scheduled.log"
$RuntimeTemp = Join-Path $RuntimeRoot "temp"
$RuntimeAclScript = Join-Path $ProjectRoot "Set-PrecisionToolsRuntimeAcl.ps1"
$WorkerPidFile = Join-Path $ProjectRoot "backend\data\quote-worker-host.pid"

foreach ($requiredPath in @($RunWorker, $RuntimeAclScript, $SecretsCsvPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Quote worker runtime input was not found: $requiredPath"
    }
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

$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$argumentLine = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-Argument $RunWorker),
    "-BackendPython", (Quote-Argument $BackendPython),
    "-OccPython", (Quote-Argument $OccPython),
    "-LogPath", (Quote-Argument $RuntimeLog),
    "-RuntimeTempRoot", (Quote-Argument $RuntimeTemp)
) -join " "

$action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument $argumentLine `
    -WorkingDirectory $ProjectRoot

if ($RunAtStartupAsLocalService) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "RunAtStartupAsLocalService requires an elevated PowerShell session."
    }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $RuntimeAclScript `
        -ProjectRoot $ProjectRoot `
        -OccPython ([IO.Path]::GetFullPath($OccPython)) `
        -RuntimeRoot $RuntimeRoot `
        -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools LocalService runtime ACL configuration failed"
    }
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal `
        -UserId "S-1-5-19" `
        -LogonType ServiceAccount `
        -RunLevel Limited
    $approvedExistingPrincipals = @("S-1-5-18", "S-1-5-19")
}
else {
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal `
        -UserId $userId `
        -LogonType Interactive `
        -RunLevel Limited
    $approvedExistingPrincipals = @(
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    )
}
$settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    $existingActions = @($existing.Actions)
    $knownTask = (
        $existingActions.Count -eq 1 -and
        (Resolve-PrincipalSid ([string]$existing.Principal.UserId)) -in `
            $approvedExistingPrincipals -and
        [string]$existingActions[0].Execute -eq $powerShell -and
        [string]$existingActions[0].WorkingDirectory -eq $ProjectRoot -and
        [string]$existingActions[0].Arguments -eq $argumentLine
    )
    if (-not $knownTask) {
        throw "An unowned scheduled task already uses the quote worker task name"
    }
    if ([string]$existing.State -eq "Running") {
        Stop-ScheduledTask -TaskName $TaskName -TaskPath "\"
    }
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath "\" `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Runs the Daiyujin asynchronous CAD quote worker after Windows starts." `
    -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName -TaskPath "\" | Out-Null

$installed = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction Stop
$installedActions = @($installed.Actions)
if (
    $installedActions.Count -ne 1 -or
    [string]$installedActions[0].Execute -ne $powerShell -or
    [string]$installedActions[0].WorkingDirectory -ne $ProjectRoot -or
    [string]$installedActions[0].Arguments -ne $argumentLine
) {
    throw "Quote worker scheduled task verification failed"
}

if ($RunAtStartupAsLocalService) {
    if (
        (Resolve-PrincipalSid ([string]$installed.Principal.UserId)) -ne `
            "S-1-5-19"
    ) {
        throw "Quote worker task is not registered as LocalService"
    }
    Start-ScheduledTask -TaskName $TaskName -TaskPath "\"
    $workerProcess = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Path -LiteralPath $WorkerPidFile -PathType Leaf) {
            $pidText = (Get-Content -LiteralPath $WorkerPidFile -Raw).Trim()
            $workerPid = 0
            if ([int]::TryParse($pidText, [ref]$workerPid)) {
                $workerProcess = Get-CimInstance Win32_Process -Filter (
                    "ProcessId = $workerPid"
                ) -ErrorAction SilentlyContinue
                if ($null -ne $workerProcess) {
                    break
                }
            }
        }
        Start-Sleep -Seconds 1
    }
    if ($null -eq $workerProcess) {
        throw "Quote worker did not start under the scheduled task"
    }
    $workerOwner = Invoke-CimMethod -InputObject $workerProcess `
        -MethodName GetOwnerSid -ErrorAction Stop
    if (
        [int]$workerOwner.ReturnValue -ne 0 -or
        [string]$workerOwner.Sid -ne "S-1-5-19"
    ) {
        throw "Quote worker process is not owned by LocalService"
    }
}

Write-Host "PASS: Scheduled task registered: $TaskName"
Write-Host "ProjectRoot: $ProjectRoot"
Write-Host "Launcher:    $RunWorker"
if ($RunAtStartupAsLocalService) {
    Write-Host "Trigger:     Windows startup as LocalService (S-1-5-19)"
}
else {
    Write-Host "Trigger:     User logon for $userId"
}
