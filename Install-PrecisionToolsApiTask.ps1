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
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
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

function Test-BootstrapDeploymentOperatorSid {
    param([AllowEmptyString()][string]$Sid)

    return (
        -not [string]::IsNullOrWhiteSpace($Sid) -and
        $Sid -match "^S-1-5-21-(?:\d+-){3}\d+$"
    )
}

function Assert-PrecisionToolsBootstrapSource {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$CommonPath,
        [AllowEmptyString()][string]$ExpectedOperatorSid = ""
    )

    if (
        -not [string]::IsNullOrWhiteSpace($ExpectedOperatorSid) -and
        -not (Test-BootstrapDeploymentOperatorSid -Sid $ExpectedOperatorSid)
    ) {
        throw "Precision Tools deployment operator SID is invalid"
    }
    $root = [IO.Path]::GetFullPath($SourceRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $common = [IO.Path]::GetFullPath($CommonPath)
    $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
    if (
        -not $common.StartsWith(
            $rootPrefix,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not (Test-Path -LiteralPath $root -PathType Container) -or
        -not (Test-Path -LiteralPath $common -PathType Leaf)
    ) {
        throw "Precision Tools bootstrap source is missing or escapes its root"
    }

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
    $trusted = [System.Collections.Generic.List[string]]::new()
    foreach ($sid in @("S-1-5-18", "S-1-5-32-544")) {
        [void]$trusted.Add($sid)
    }
    try {
        $trustedInstaller = [Security.Principal.NTAccount]::new(
            "NT SERVICE",
            "TrustedInstaller"
        ).Translate([Security.Principal.SecurityIdentifier]).Value
        [void]$trusted.Add($trustedInstaller)
    }
    catch {
        # TrustedInstaller is unavailable on some Windows editions.
    }

    $records = [System.Collections.Generic.List[object]]::new()
    $operatorCandidates = [System.Collections.Generic.List[string]]::new()
    foreach ($path in @($root, $common)) {
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "Precision Tools bootstrap source contains a reparse point"
        }
        $acl = Get-Acl -LiteralPath $path
        $owner = $acl.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value
        if (Test-BootstrapDeploymentOperatorSid -Sid $owner) {
            [void]$operatorCandidates.Add($owner)
        }
        $rules = @($acl.GetAccessRules(
            $true,
            $true,
            [Security.Principal.SecurityIdentifier]
        ))
        foreach ($rule in $rules) {
            $sid = [string]$rule.IdentityReference.Value
            if (
                $rule.AccessControlType -eq
                    [Security.AccessControl.AccessControlType]::Allow -and
                (([int64]$rule.FileSystemRights -band $writeRights) -ne 0) -and
                (Test-BootstrapDeploymentOperatorSid -Sid $sid)
            ) {
                [void]$operatorCandidates.Add($sid)
            }
        }
        [void]$records.Add([pscustomobject]@{
            Path = $path
            Owner = $owner
            Rules = $rules
        })
    }
    $operators = @($operatorCandidates | Select-Object -Unique)
    if ($operators.Count -gt 1) {
        throw "Precision Tools bootstrap source has multiple deployment operators"
    }
    $inferredOperatorSid = if ($operators.Count -eq 1) {
        [string]$operators[0]
    }
    else {
        ""
    }
    if (
        $ExpectedOperatorSid -and
        $inferredOperatorSid -and
        $ExpectedOperatorSid -ne $inferredOperatorSid
    ) {
        throw "Precision Tools bootstrap source has an unexpected deployment operator"
    }
    $approvedOperatorSid = if ($ExpectedOperatorSid) {
        $ExpectedOperatorSid
    }
    else {
        $inferredOperatorSid
    }
    if ($approvedOperatorSid) {
        [void]$trusted.Add($approvedOperatorSid)
    }
    $trustedSids = @($trusted | Select-Object -Unique)
    foreach ($record in $records) {
        if ([string]$record.Owner -notin $trustedSids) {
            throw "Precision Tools bootstrap source has an untrusted owner"
        }
        foreach ($rule in $record.Rules) {
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
    return $approvedOperatorSid
}

if (-not (Test-Administrator)) {
    throw "Precision Tools API task installation must run from elevated PowerShell"
}
$scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = $scriptRoot
}
$requestedRoot = [IO.Path]::GetFullPath($ProjectRoot)
if (-not $requestedRoot.Equals(
    $scriptRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Production task installation requires the installer's source root"
}
$root = (Resolve-Path -LiteralPath $scriptRoot).Path
$environmentCommon = Join-Path $root "PrecisionToolsEnvironment.Common.ps1"
$currentSourceSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$expectedSourceOperatorSid = if (
    Test-BootstrapDeploymentOperatorSid -Sid $currentSourceSid
) {
    $currentSourceSid
}
else {
    ""
}
$sourceOperatorSid = [string](Assert-PrecisionToolsBootstrapSource `
    -SourceRoot $root `
    -CommonPath $environmentCommon `
    -ExpectedOperatorSid $expectedSourceOperatorSid)
. $environmentCommon
$environment = Assert-PrecisionToolsFixedEnvironmentPath -Path $EnvironmentFile
$expectedBackendPython = [IO.Path]::GetFullPath(
    (Join-Path $root ".venv\Scripts\python.exe")
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
$OccPython = [IO.Path]::GetFullPath($OccPython)
if (
    -not $BackendPython.Equals(
        $expectedBackendPython,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not $OccPython.Equals(
        $expectedOccPython,
        [StringComparison]::OrdinalIgnoreCase
    )
) {
    throw "Production API installation requires the fixed Python runtimes"
}
$launcher = Join-Path $root "run-api.ps1"
$database = Join-Path $root "backend\data\daiyujin.db"
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
[void](Assert-PrecisionToolsProductionEnvironmentFile -Path $environment)
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $launcher `
    -SourceRoot $root `
    -Label "Precision Tools API launcher" `
    -DeploymentOperatorSid $sourceOperatorSid)
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $aclScript `
    -SourceRoot $root `
    -Label "Precision Tools runtime ACL script" `
    -DeploymentOperatorSid $sourceOperatorSid)
$BackendPython = Assert-PrecisionToolsTrustedExecutable `
    -Path $BackendPython `
    -AllowedRoots @((Join-Path $root ".venv")) `
    -Label "Precision Tools backend Python" `
    -DeploymentOperatorSid $sourceOperatorSid
$OccPython = Assert-PrecisionToolsTrustedExecutable `
    -Path $OccPython `
    -AllowedRoots @("C:\ProgramData\Daiyujin\Dependencies") `
    -Label "Precision Tools OCC Python" `
    -DeploymentOperatorSid $sourceOperatorSid
if ($ApiPort -ne 5000) {
    throw "Precision Tools public API contract requires loopback port 5000"
}

Write-Host "Precision Tools API scheduled-task plan"
Write-Host "  Task: $TaskName"
Write-Host "  Origin: http://127.0.0.1:$ApiPort"
Write-Host "  Principal: LocalService (S-1-5-19)"
Write-Host "  EnvironmentFile: $environment"
if ($Confirmation -cne "INSTALL_PRECISION_TOOLS_API_TASK") {
    Write-Host "Plan only. Re-run with -Confirmation INSTALL_PRECISION_TOOLS_API_TASK"
    exit 0
}

$powerShellRoot = Join-Path (
    [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
) "System32"
$powerShell = Assert-PrecisionToolsTrustedExecutable `
    -Path (Join-Path $powerShellRoot "WindowsPowerShell\v1.0\powershell.exe") `
    -AllowedRoots @($powerShellRoot) `
    -Label "Windows PowerShell"
& $powerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $aclScript `
    -ProjectRoot $root `
    -OccPython ([IO.Path]::GetFullPath($OccPython)) `
    -RuntimeRoot ([IO.Path]::GetFullPath($RuntimeRoot)) `
    -EnvironmentFile $environment `
    -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools LocalService runtime ACL configuration failed"
}

& $BackendPython -E -B -c "import flask, sqlalchemy, waitress"
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools backend dependencies cannot be imported"
}
& $OccPython -E -B -c "from OCC.Core.STEPControl import STEPControl_Reader"
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools OCC runtime cannot be imported"
}

$arguments = @(
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-Argument $launcher),
    "-BackendPython", (Quote-Argument ([IO.Path]::GetFullPath($BackendPython))),
    "-OccPython", (Quote-Argument ([IO.Path]::GetFullPath($OccPython))),
    "-RuntimeTempRoot", (Quote-Argument $runtimeTemp),
    "-EnvironmentFile", (Quote-Argument $environment),
    "-DeploymentOperatorSid", (Quote-Argument $sourceOperatorSid),
    "-ApiPort", $ApiPort
) -join " "
$taskDescription = "Runs the loopback-only Daiyujin Precision Tools API."

function Test-OwnedPrecisionToolsApiTask {
    param([Parameter(Mandatory = $true)][object]$Task)

    $actions = @($Task.Actions)
    $triggers = @($Task.Triggers)
    $principalSid = Resolve-PrincipalSid ([string]$Task.Principal.UserId)
    return (
        [string]$Task.Description -eq $taskDescription -and
        $actions.Count -eq 1 -and
        $triggers.Count -eq 1 -and
        $principalSid -in @("S-1-5-18", "S-1-5-19") -and
        [string]$actions[0].Execute -eq $powerShell -and
        [string]$actions[0].WorkingDirectory -eq $root -and
        [string]$actions[0].Arguments -eq $arguments -and
        [string]$triggers[0].CimClass.CimClassName -eq
            "MSFT_TaskBootTrigger"
    )
}

function Get-CimProcessCreationUtc {
    param([Parameter(Mandatory = $true)][object]$Process)

    if ($Process.CreationDate -is [DateTime]) {
        return ([DateTime]$Process.CreationDate).ToUniversalTime()
    }
    return [Management.ManagementDateTimeConverter]::ToDateTime(
        [string]$Process.CreationDate
    ).ToUniversalTime()
}

function Test-ExpectedPrecisionToolsApiProcess {
    param(
        [Parameter(Mandatory = $true)][object]$Process,
        [Parameter(Mandatory = $true)][DateTime]$StartedAfterUtc
    )

    if (
        [string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath) -or
        [string]::IsNullOrWhiteSpace([string]$Process.CommandLine)
    ) {
        return $false
    }
    $actualExecutable = [IO.Path]::GetFullPath(
        [string]$Process.ExecutablePath
    )
    if (-not $actualExecutable.Equals(
        [IO.Path]::GetFullPath($BackendPython),
        [StringComparison]::OrdinalIgnoreCase
    )) {
        return $false
    }
    $commandLine = [string]$Process.CommandLine
    foreach ($requiredArgument in @(
        "-E",
        "-m waitress",
        "--listen=127.0.0.1:$ApiPort",
        "--threads=16",
        "--channel-timeout=300",
        "app:app"
    )) {
        if ($commandLine.IndexOf(
            $requiredArgument,
            [StringComparison]::OrdinalIgnoreCase
        ) -lt 0) {
            return $false
        }
    }
    return (
        (Get-CimProcessCreationUtc -Process $Process) -ge
            $StartedAfterUtc.AddSeconds(-2)
    )
}

function Get-VerifiedPrecisionToolsApiProcess {
    param([Parameter(Mandatory = $true)][DateTime]$StartedAfterUtc)

    $listeners = @(
        Get-NetTCPConnection -LocalPort $ApiPort -State Listen `
            -ErrorAction SilentlyContinue
    )
    if (
        $listeners.Count -ne 1 -or
        [string]$listeners[0].LocalAddress -ne "127.0.0.1"
    ) {
        return $null
    }
    $process = Get-CimInstance Win32_Process -Filter (
        "ProcessId = {0}" -f [int]$listeners[0].OwningProcess
    ) -ErrorAction SilentlyContinue
    if (
        $null -eq $process -or
        -not (Test-ExpectedPrecisionToolsApiProcess `
            -Process $process `
            -StartedAfterUtc $StartedAfterUtc)
    ) {
        return $null
    }
    $owner = Invoke-CimMethod -InputObject $process `
        -MethodName GetOwnerSid -ErrorAction Stop
    if (
        [int]$owner.ReturnValue -ne 0 -or
        [string]$owner.Sid -ne "S-1-5-19"
    ) {
        return $null
    }
    return $process
}

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    if (-not (Test-OwnedPrecisionToolsApiTask -Task $existing)) {
        throw "An unowned scheduled task already uses the approved task name"
    }
    if ([string]$existing.State -eq "Running") {
        Stop-ScheduledTask -TaskName $TaskName -TaskPath "\"
    }
}
$listenerDeadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $existingState = if ($null -ne $existing) {
        [string](Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
            -ErrorAction Stop).State
    }
    else {
        "Absent"
    }
    $existingListeners = @(
        Get-NetTCPConnection -LocalPort $ApiPort -State Listen `
            -ErrorAction SilentlyContinue
    )
    if (
        $existingListeners.Count -eq 0 -and
        $existingState -ne "Running"
    ) {
        break
    }
    if ($null -eq $existing) {
        throw "Port 5000 is already owned by a process outside the approved task"
    }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $listenerDeadline)
if (
    $existingListeners.Count -ne 0 -or
    $existingState -eq "Running"
) {
    throw "The previous approved API task or listener did not stop"
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

$registrationTarget = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
if ($null -ne $registrationTarget) {
    if (
        $null -eq $existing -or
        -not (Test-OwnedPrecisionToolsApiTask -Task $registrationTarget) -or
        [string]$registrationTarget.State -eq "Running"
    ) {
        throw "The API task changed after ownership verification"
    }
}
elseif ($null -ne $existing) {
    throw "The approved API task disappeared before registration"
}

Register-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description $taskDescription `
    -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName -TaskPath "\" | Out-Null

$installed = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction Stop
if (
    -not (Test-OwnedPrecisionToolsApiTask -Task $installed) -or
    (Resolve-PrincipalSid ([string]$installed.Principal.UserId)) -ne
        "S-1-5-19"
) {
    throw "Precision Tools API scheduled-task registration verification failed"
}

$startRequestedUtc = [DateTime]::UtcNow
Start-ScheduledTask -TaskName $TaskName -TaskPath "\"

$verifiedProcess = $null
$verifiedHealth = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $runningTask = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
        -ErrorAction Stop
    if (
        -not (Test-OwnedPrecisionToolsApiTask -Task $runningTask) -or
        (Resolve-PrincipalSid ([string]$runningTask.Principal.UserId)) -ne
            "S-1-5-19"
    ) {
        throw "Precision Tools API task changed during startup"
    }
    if ([string]$runningTask.State -eq "Running") {
        $candidate = Get-VerifiedPrecisionToolsApiProcess `
            -StartedAfterUtc $startRequestedUtc
        if ($null -ne $candidate) {
            try {
                $response = Invoke-RestMethod `
                    -Uri "http://127.0.0.1:$ApiPort/api/health" `
                    -TimeoutSec 2
                if (
                    $response.error -eq $false -and
                    $response.ok -eq $true -and
                    [string]$response.service -eq
                        "daiyujin-precision-tools" -and
                    $response.production -eq $true -and
                    [int]$response.process_id -eq [int]$candidate.ProcessId -and
                    [double]$response.process_started_at_epoch -gt 0
                ) {
                    $verifiedProcess = $candidate
                    $verifiedHealth = $response
                    break
                }
            }
            catch {
                # The newly-created listener may not have completed startup.
            }
        }
    }
    Start-Sleep -Seconds 1
}
if ($null -eq $verifiedProcess) {
    throw (
        "Precision Tools API task did not produce a verified, newly-created " +
        "LocalService listener"
    )
}

$verifiedPid = [int]$verifiedProcess.ProcessId
$verifiedCreationUtc = Get-CimProcessCreationUtc -Process $verifiedProcess
Start-Sleep -Seconds 2

$stableTask = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction Stop
if (
    -not (Test-OwnedPrecisionToolsApiTask -Task $stableTask) -or
    (Resolve-PrincipalSid ([string]$stableTask.Principal.UserId)) -ne
        "S-1-5-19" -or
    [string]$stableTask.State -ne "Running"
) {
    throw "Precision Tools API task was not stable after startup"
}
$stableProcess = Get-VerifiedPrecisionToolsApiProcess `
    -StartedAfterUtc $startRequestedUtc
if (
    $null -eq $stableProcess -or
    [int]$stableProcess.ProcessId -ne $verifiedPid -or
    (Get-CimProcessCreationUtc -Process $stableProcess) -ne
        $verifiedCreationUtc
) {
    throw "Precision Tools API listener changed during readiness verification"
}
try {
    $stableHealth = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$ApiPort/api/health" `
        -TimeoutSec 2
}
catch {
    throw "Precision Tools API delayed health verification failed"
}
if (
    $stableHealth.error -ne $false -or
    $stableHealth.ok -ne $true -or
    [string]$stableHealth.service -ne "daiyujin-precision-tools" -or
    $stableHealth.production -ne $true -or
    [int]$stableHealth.process_id -ne $verifiedPid -or
    [double]$stableHealth.process_started_at_epoch -le 0 -or
    [double]$stableHealth.process_started_at_epoch -ne
        [double]$verifiedHealth.process_started_at_epoch
) {
    throw "Precision Tools API health identity changed after startup"
}
Write-Host "Precision Tools API scheduled task: READY"
Write-Host "Health: http://127.0.0.1:$ApiPort/api/health"
