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
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
    [string]$Confirmation = "",
    [switch]$Remove
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom

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

function Assert-NoReparsePathBeforeCommon {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [IO.Path]::GetFullPath($Path)
    $pathRoot = [IO.Path]::GetPathRoot($resolved)
    $current = $pathRoot
    foreach ($segment in $resolved.Substring($pathRoot.Length).Split(
        [char[]]@('\', '/'),
        [StringSplitOptions]::RemoveEmptyEntries
    )) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) {
            continue
        }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "Precision Tools bootstrap path contains a reparse point"
        }
    }
}

function Assert-PrecisionToolsBootstrapSource {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$CommonPath
    )

    $root = [IO.Path]::GetFullPath($SourceRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $common = [IO.Path]::GetFullPath($CommonPath)
    if (
        -not $common.StartsWith(
            $root + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not (Test-Path -LiteralPath $root -PathType Container) -or
        -not (Test-Path -LiteralPath $common -PathType Leaf)
    ) {
        throw "Precision Tools bootstrap source is missing or escapes its root"
    }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $operatorSid = if ($currentSid -match "^S-1-5-21-(?:\d+-){3}\d+$") {
        $currentSid
    }
    else {
        ""
    }
    $trustedSids = @("S-1-5-18", "S-1-5-32-544")
    if ($operatorSid) {
        $trustedSids += $operatorSid
    }
    try {
        $trustedSids += [Security.Principal.NTAccount]::new(
            "NT SERVICE",
            "TrustedInstaller"
        ).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    catch {
        # TrustedInstaller is unavailable on some Windows editions.
    }
    $trustedSids = @($trustedSids | Select-Object -Unique)
    $writeRights = [int64](
        [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::CreateFiles -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::CreateDirectories -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    foreach ($path in @($root, $common)) {
        Assert-NoReparsePathBeforeCommon -Path $path
        $acl = Get-Acl -LiteralPath $path
        $owner = $acl.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value
        if ($owner -notin $trustedSids) {
            throw "Precision Tools bootstrap source has an untrusted owner"
        }
        foreach ($rule in $acl.GetAccessRules(
            $true,
            $true,
            [Security.Principal.SecurityIdentifier]
        )) {
            if (
                $rule.AccessControlType -eq
                    [Security.AccessControl.AccessControlType]::Allow -and
                [string]$rule.IdentityReference.Value -notin $trustedSids -and
                (([int64]$rule.FileSystemRights -band $writeRights) -ne 0)
            ) {
                throw "Precision Tools bootstrap source is writable by an untrusted principal"
            }
        }
    }
    return $operatorSid
}

function Get-ProtectedEnvironmentValue {
    param(
        [string]$Path,
        [string]$Key
    )

    $matches = @(
        [IO.File]::ReadAllLines($Path, [Text.Encoding]::UTF8) |
            ForEach-Object {
                $line = $_.Trim()
                if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
                    return
                }
                $parts = $line.Split("=", 2)
                if ($parts[0].Trim() -ceq $Key) {
                    $parts[1].Trim().Trim('"').Trim("'")
                }
            }
    )
    if ($matches.Count -ne 1 -or [string]::IsNullOrWhiteSpace($matches[0])) {
        throw "Protected EnvironmentFile must contain exactly one $Key value"
    }
    return [string]$matches[0]
}

$scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = $scriptRoot
}
if (-not [IO.Path]::GetFullPath($ProjectRoot).Equals(
    $scriptRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Production task installation requires the installer's source root"
}
$ProjectRoot = (Resolve-Path -LiteralPath $scriptRoot).Path
$environmentCommon = Join-Path $ProjectRoot `
    "PrecisionToolsEnvironment.Common.ps1"
$sourceOperatorSid = [string](Assert-PrecisionToolsBootstrapSource `
    -SourceRoot $ProjectRoot `
    -CommonPath $environmentCommon)
. $environmentCommon
$EnvironmentFile = Assert-PrecisionToolsFixedEnvironmentPath `
    -Path $EnvironmentFile
$RunWorker = Join-Path $ProjectRoot "run-quote-worker.ps1"
$RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$RuntimeLog = Join-Path $RuntimeRoot "logs\quote-worker-scheduled.log"
$RuntimeTemp = Join-Path $RuntimeRoot "temp"
$RuntimeAclScript = Join-Path $ProjectRoot "Set-PrecisionToolsRuntimeAcl.ps1"
$WorkerPidFile = Join-Path $ProjectRoot "backend\data\quote-worker-host.pid"
$WorkerLockFile = Join-Path $ProjectRoot "backend\data\quote-worker-host.lock"
$taskDescription = (
    "Runs the Daiyujin asynchronous CAD quote worker after Windows starts."
)

[void](Assert-PrecisionToolsProductionEnvironmentFile -Path $EnvironmentFile)
$configuredBackendPython = Get-ProtectedEnvironmentValue `
    -Path $EnvironmentFile `
    -Key "BACKEND_PYTHON"
$configuredOccPython = Get-ProtectedEnvironmentValue `
    -Path $EnvironmentFile `
    -Key "OCC_PYTHON"
$expectedBackendPython = [IO.Path]::GetFullPath(
    (Join-Path $ProjectRoot ".venv\Scripts\python.exe")
)
$expectedOccPython = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
)
$BackendPython = if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $expectedBackendPython
}
else {
    [IO.Path]::GetFullPath($BackendPython)
}
$OccPython = if ([string]::IsNullOrWhiteSpace($OccPython)) {
    $expectedOccPython
}
else {
    [IO.Path]::GetFullPath($OccPython)
}
if (
    -not $BackendPython.Equals(
        $expectedBackendPython,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not $OccPython.Equals(
        $expectedOccPython,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not ([IO.Path]::GetFullPath($configuredBackendPython)).Equals(
        $expectedBackendPython,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not ([IO.Path]::GetFullPath($configuredOccPython)).Equals(
        $expectedOccPython,
        [StringComparison]::OrdinalIgnoreCase
    )
) {
    throw "Production quote-worker installation requires the fixed Python runtimes"
}
$BackendPython = Assert-PrecisionToolsTrustedExecutable `
    -Path $BackendPython `
    -AllowedRoots @((Join-Path $ProjectRoot ".venv")) `
    -Label "Precision Tools backend Python" `
    -DeploymentOperatorSid $sourceOperatorSid
$OccPython = Assert-PrecisionToolsTrustedExecutable `
    -Path $OccPython `
    -AllowedRoots @("C:\ProgramData\Daiyujin\Dependencies") `
    -Label "Precision Tools OCC Python" `
    -DeploymentOperatorSid $sourceOperatorSid
[void](Assert-PrecisionToolsPathContained `
    -Path $RuntimeLog `
    -Root $RuntimeRoot `
    -Label "Precision Tools quote-worker log")
[void](Assert-PrecisionToolsPathContained `
    -Path $RuntimeTemp `
    -Root $RuntimeRoot `
    -Label "Precision Tools quote-worker temporary directory")
$workerDataRoot = Join-Path $ProjectRoot "backend\data"
[void](Assert-PrecisionToolsPathContained `
    -Path $WorkerPidFile `
    -Root $workerDataRoot `
    -Label "Precision Tools quote-worker PID file")
[void](Assert-PrecisionToolsPathContained `
    -Path $WorkerLockFile `
    -Root $workerDataRoot `
    -Label "Precision Tools quote-worker lock file")

foreach ($requiredPath in @(
    $RunWorker,
    $RuntimeAclScript,
    $EnvironmentFile
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Quote worker runtime input was not found: $requiredPath"
    }
}
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $RunWorker `
    -SourceRoot $ProjectRoot `
    -Label "Precision Tools quote-worker launcher" `
    -DeploymentOperatorSid $sourceOperatorSid)
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $RuntimeAclScript `
    -SourceRoot $ProjectRoot `
    -Label "Precision Tools runtime ACL script" `
    -DeploymentOperatorSid $sourceOperatorSid)
if (
    -not $Remove -and
    -not (Test-Path -LiteralPath $SecretsCsvPath -PathType Leaf)
) {
    throw "Quote worker secrets input was not found: $SecretsCsvPath"
}

$powerShellRoot = Join-Path (
    [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
) "System32"
$powerShell = Assert-PrecisionToolsTrustedExecutable `
    -Path (Join-Path $powerShellRoot "WindowsPowerShell\v1.0\powershell.exe") `
    -AllowedRoots @($powerShellRoot) `
    -Label "Windows PowerShell"
$argumentLine = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-Argument $RunWorker),
    "-BackendPython", (Quote-Argument $BackendPython),
    "-OccPython", (Quote-Argument $OccPython),
    "-LogPath", (Quote-Argument $RuntimeLog),
    "-RuntimeTempRoot", (Quote-Argument $RuntimeTemp),
    "-EnvironmentFile", (Quote-Argument $EnvironmentFile),
    "-DeploymentOperatorSid", (Quote-Argument $sourceOperatorSid)
) -join " "
$approvedExistingPrincipals = @("S-1-5-18", "S-1-5-19")

function Test-OwnedQuoteWorkerTask {
    param([Parameter(Mandatory = $true)][object]$Task)

    $actions = @($Task.Actions)
    return (
        [string]$Task.Description -eq $taskDescription -and
        $actions.Count -eq 1 -and
        (Resolve-PrincipalSid ([string]$Task.Principal.UserId)) -in
            $approvedExistingPrincipals -and
        [string]$actions[0].Execute -eq $powerShell -and
        [string]$actions[0].WorkingDirectory -eq $ProjectRoot -and
        [string]$actions[0].Arguments -eq $argumentLine
    )
}

function Test-ExpectedWorkerHostProcess {
    param([Parameter(Mandatory = $true)][object]$Process)

    if (
        [string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath) -or
        [string]::IsNullOrWhiteSpace([string]$Process.CommandLine)
    ) {
        return $false
    }
    $executable = [IO.Path]::GetFullPath([string]$Process.ExecutablePath)
    return (
        $executable.Equals(
            [IO.Path]::GetFullPath($powerShell),
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        [string]$Process.CommandLine -match '(?i)(^|\s)-File(\s|$)' -and
        ([string]$Process.CommandLine).IndexOf(
            $RunWorker,
            [StringComparison]::OrdinalIgnoreCase
        ) -ge 0
    )
}

function Get-WorkerPidProcess {
    if (-not (Test-Path -LiteralPath $WorkerPidFile -PathType Leaf)) {
        return $null
    }
    [void](Assert-PrecisionToolsPathContained `
        -Path $WorkerPidFile `
        -Root $workerDataRoot `
        -Label "Precision Tools quote-worker PID file")
    $pidText = (Get-Content -LiteralPath $WorkerPidFile -Raw).Trim()
    $workerPid = 0
    if (-not [int]::TryParse($pidText, [ref]$workerPid) -or $workerPid -le 0) {
        throw "Quote-worker PID file is malformed"
    }
    return Get-CimInstance Win32_Process -Filter (
        "ProcessId = $workerPid"
    ) -ErrorAction SilentlyContinue
}

function Wait-OwnedQuoteWorkerStopped {
    param([Parameter(Mandatory = $true)][object]$Task)

    if (-not (Test-OwnedQuoteWorkerTask -Task $Task)) {
        throw "Refusing to stop an unowned scheduled task"
    }
    if ([string]$Task.State -eq "Running") {
        Stop-ScheduledTask -TaskName $TaskName -TaskPath "\"
    }
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $currentTask = Get-ScheduledTask `
            -TaskName $TaskName `
            -TaskPath "\" `
            -ErrorAction Stop
        $pidProcess = Get-WorkerPidProcess
        if (
            $null -ne $pidProcess -and
            -not (Test-ExpectedWorkerHostProcess -Process $pidProcess)
        ) {
            throw "Quote-worker PID file references an unrelated process"
        }
        if (
            [string]$currentTask.State -ne "Running" -and
            $null -eq $pidProcess
        ) {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "Owned quote-worker task or process did not stop within 60 seconds"
}

function Clear-StaleOwnedWorkerState {
    param([switch]$OwnedTaskVerified)

    if (-not $OwnedTaskVerified) {
        throw "Refusing to clear quote-worker state without exact task ownership"
    }
    foreach ($statePath in @($WorkerPidFile, $WorkerLockFile)) {
        [void](Assert-PrecisionToolsPathContained `
            -Path $statePath `
            -Root $workerDataRoot `
            -Label "Precision Tools quote-worker state")
    }
    if (Test-Path -LiteralPath $WorkerPidFile -PathType Leaf) {
        if ($null -ne (Get-WorkerPidProcess)) {
            throw "Refusing to remove a live quote-worker PID file"
        }
        Remove-Item -LiteralPath $WorkerPidFile -Force
    }
    if (Test-Path -LiteralPath $WorkerLockFile -PathType Leaf) {
        Assert-PrecisionToolsNoReparsePoints -Path $WorkerLockFile
        $lockProbe = $null
        try {
            $lockProbe = [IO.File]::Open(
                $WorkerLockFile,
                [IO.FileMode]::Open,
                [IO.FileAccess]::ReadWrite,
                [IO.FileShare]::None
            )
        }
        catch [IO.IOException] {
            throw "Quote-worker lock is still held after task stop"
        }
        finally {
            if ($lockProbe) {
                $lockProbe.Dispose()
            }
        }
        Remove-Item -LiteralPath $WorkerLockFile -Force
    }
}

if ($Remove) {
    Write-Host "Precision Tools quote-worker removal plan"
    Write-Host "  Task: $TaskName"
    if ($Confirmation -cne "REMOVE_QUOTE_WORKER_TASK") {
        Write-Host "Plan only. Re-run with -Confirmation REMOVE_QUOTE_WORKER_TASK"
        exit 0
    }
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
        -ErrorAction SilentlyContinue
    if ($existing) {
        if (-not (Test-OwnedQuoteWorkerTask -Task $existing)) {
            throw "Refusing to remove an unowned scheduled task"
        }
        Wait-OwnedQuoteWorkerStopped -Task $existing
        Clear-StaleOwnedWorkerState -OwnedTaskVerified
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath "\" `
            -Confirm:$false
        Write-Host "Removed scheduled task: $TaskName"
    }
    else {
        Write-Host "Scheduled task is already absent: $TaskName"
    }
    exit 0
}

Write-Host "Precision Tools quote-worker scheduled-task plan"
Write-Host "  Task: $TaskName"
Write-Host "  Principal: $(
    if ($RunAtStartupAsLocalService) {
        'LocalService (S-1-5-19)'
    }
    else {
        'Current interactive user'
    }
)"
Write-Host "  EnvironmentFile: $EnvironmentFile"
if ($Confirmation -cne "INSTALL_QUOTE_WORKER_TASK") {
    Write-Host "Plan only. Re-run with -Confirmation INSTALL_QUOTE_WORKER_TASK"
    exit 0
}
if (-not $RunAtStartupAsLocalService) {
    throw (
        "Production installation requires -RunAtStartupAsLocalService so the " +
        "worker does not depend on an interactive login."
    )
}

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
    & $powerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $RuntimeAclScript `
        -ProjectRoot $ProjectRoot `
        -OccPython ([IO.Path]::GetFullPath($OccPython)) `
        -RuntimeRoot $RuntimeRoot `
        -EnvironmentFile $EnvironmentFile `
        -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools LocalService runtime ACL configuration failed"
    }
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal `
        -UserId "S-1-5-19" `
        -LogonType ServiceAccount `
        -RunLevel Limited
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

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
$previousWorkerPid = 0
if ($null -ne $existing) {
    if (-not (Test-OwnedQuoteWorkerTask -Task $existing)) {
        throw "An unowned scheduled task already uses the quote worker task name"
    }
    $oldWorkerProcess = Get-WorkerPidProcess
    if ($null -ne $oldWorkerProcess) {
        if (-not (Test-ExpectedWorkerHostProcess -Process $oldWorkerProcess)) {
            throw "Quote-worker PID file references an unrelated process"
        }
        $previousWorkerPid = [int]$oldWorkerProcess.ProcessId
    }
    Wait-OwnedQuoteWorkerStopped -Task $existing
    Clear-StaleOwnedWorkerState -OwnedTaskVerified
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath "\" `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description $taskDescription `
    -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName -TaskPath "\" | Out-Null

$installed = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction Stop
$installedActions = @($installed.Actions)
if (
    [string]$installed.Description -ne $taskDescription -or
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
    $startRequestedUtc = [DateTime]::UtcNow
    Start-ScheduledTask -TaskName $TaskName -TaskPath "\"
    $workerProcess = $null
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        $runningTask = Get-ScheduledTask `
            -TaskName $TaskName `
            -TaskPath "\" `
            -ErrorAction Stop
        if ([string]$runningTask.State -eq "Running") {
            $candidate = Get-WorkerPidProcess
            if (
                $null -ne $candidate -and
                [int]$candidate.ProcessId -ne $previousWorkerPid -and
                (Test-ExpectedWorkerHostProcess -Process $candidate)
            ) {
                $created = if ($candidate.CreationDate -is [DateTime]) {
                    ([DateTime]$candidate.CreationDate).ToUniversalTime()
                }
                else {
                    [Management.ManagementDateTimeConverter]::ToDateTime(
                        [string]$candidate.CreationDate
                    ).ToUniversalTime()
                }
                if ($created -ge $startRequestedUtc.AddSeconds(-2)) {
                    $owner = Invoke-CimMethod `
                        -InputObject $candidate `
                        -MethodName GetOwnerSid `
                        -ErrorAction Stop
                    if (
                        [int]$owner.ReturnValue -ne 0 -or
                        [string]$owner.Sid -ne "S-1-5-19"
                    ) {
                        throw "Quote worker process is not owned by LocalService"
                    }
                    $workerProcess = $candidate
                    break
                }
            }
        }
        Start-Sleep -Seconds 1
    }
    if ($null -eq $workerProcess) {
        throw "A new quote worker did not start under the scheduled task"
    }
    Start-Sleep -Seconds 2
    $stableTask = Get-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath "\" `
        -ErrorAction Stop
    $stableProcess = Get-CimInstance Win32_Process -Filter (
        "ProcessId = $([int]$workerProcess.ProcessId)"
    ) -ErrorAction SilentlyContinue
    if (
        [string]$stableTask.State -ne "Running" -or
        $null -eq $stableProcess -or
        -not (Test-ExpectedWorkerHostProcess -Process $stableProcess)
    ) {
        throw "New quote worker did not remain running after startup verification"
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
