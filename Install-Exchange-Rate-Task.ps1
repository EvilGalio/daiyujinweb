[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$BackendPython = "",
    [string]$TaskName = "Daiyujin Exchange Rate Update",
    [string]$At = "09:00",
    [switch]$RunAsLocalService,
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
    throw "Exchange-rate task installation requires elevated PowerShell"
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
$ProjectRoot = (Resolve-Path -LiteralPath $scriptRoot).Path
$environmentCommon = Join-Path $ProjectRoot `
    "PrecisionToolsEnvironment.Common.ps1"
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
    -SourceRoot $ProjectRoot `
    -CommonPath $environmentCommon `
    -ExpectedOperatorSid $expectedSourceOperatorSid)
. $environmentCommon
$EnvironmentFile = Assert-PrecisionToolsFixedEnvironmentPath `
    -Path $EnvironmentFile
[void](Assert-PrecisionToolsProductionEnvironmentFile -Path $EnvironmentFile)

$RunScript = Join-Path $ProjectRoot "run-exchange-rate-update.ps1"
$RuntimeAclScript = Join-Path $ProjectRoot "Set-PrecisionToolsRuntimeAcl.ps1"
$RuntimeRoot = Assert-PrecisionToolsPathContained `
    -Path ([IO.Path]::GetFullPath($RuntimeRoot)) `
    -Root "C:\ProgramData\Daiyujin\PrecisionTools\runtime" `
    -Label "Precision Tools exchange-rate runtime root"
$RuntimeLog = Join-Path $RuntimeRoot "logs\exchange-rate-update.log"
$expectedBackendPython = [IO.Path]::GetFullPath(
    (Join-Path $ProjectRoot ".venv\Scripts\python.exe")
)
$BackendPython = if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $expectedBackendPython
}
else {
    [IO.Path]::GetFullPath($BackendPython)
}
if (-not $BackendPython.Equals(
    $expectedBackendPython,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Production exchange-rate installation requires the fixed backend Python"
}
foreach ($path in @(
    $RunScript,
    $RuntimeAclScript,
    $BackendPython,
    $SecretsCsvPath,
    $EnvironmentFile
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Exchange-rate runtime input was not found: $path"
    }
}
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $RunScript `
    -SourceRoot $ProjectRoot `
    -Label "Precision Tools exchange-rate launcher" `
    -DeploymentOperatorSid $sourceOperatorSid)
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $RuntimeAclScript `
    -SourceRoot $ProjectRoot `
    -Label "Precision Tools runtime ACL script" `
    -DeploymentOperatorSid $sourceOperatorSid)
$BackendPython = Assert-PrecisionToolsTrustedExecutable `
    -Path $BackendPython `
    -AllowedRoots @((Join-Path $ProjectRoot ".venv")) `
    -Label "Precision Tools backend Python" `
    -DeploymentOperatorSid $sourceOperatorSid

Write-Host "Precision Tools exchange-rate scheduled-task plan"
Write-Host "  Task: $TaskName"
Write-Host "  Daily: $At"
Write-Host "  Principal: LocalService (S-1-5-19)"
Write-Host "  EnvironmentFile: $EnvironmentFile"
if ($Confirmation -cne "INSTALL_EXCHANGE_RATE_TASK") {
    Write-Host (
        "Plan only. Re-run with -RunAsLocalService " +
        "-Confirmation INSTALL_EXCHANGE_RATE_TASK"
    )
    exit 0
}
if (-not $RunAsLocalService) {
    throw (
        "Production installation requires -RunAsLocalService so the " +
        "exchange-rate task uses the reviewed runtime SID."
    )
}

$powerShellRoot = Join-Path (
    [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
) "System32"
$powerShell = Assert-PrecisionToolsTrustedExecutable `
    -Path (Join-Path $powerShellRoot "WindowsPowerShell\v1.0\powershell.exe") `
    -AllowedRoots @($powerShellRoot) `
    -Label "Windows PowerShell"
& $powerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $RuntimeAclScript `
    -ProjectRoot $ProjectRoot `
    -EnvironmentFile $EnvironmentFile `
    -RuntimeRoot $RuntimeRoot `
    -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools LocalService runtime ACL configuration failed"
}

& $BackendPython -E -B -c "import sqlalchemy"
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools exchange-rate dependencies cannot be imported"
}
$argumentLine = @(
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-Argument $RunScript),
    "-BackendPython", (Quote-Argument $BackendPython),
    "-EnvironmentFile", (Quote-Argument $EnvironmentFile),
    "-LogPath", (Quote-Argument $RuntimeLog),
    "-DeploymentOperatorSid", (Quote-Argument $sourceOperatorSid)
) -join " "
$action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument $argumentLine `
    -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$taskDescription = (
    "Refresh Daiyujin exchange rates as the protected LocalService runtime."
)
$principal = New-ScheduledTaskPrincipal `
    -UserId "S-1-5-19" `
    -LogonType ServiceAccount `
    -RunLevel Limited

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    $existingActions = @($existing.Actions)
    $existingTriggers = @($existing.Triggers)
    $knownTask = (
        [string]$existing.Description -eq $taskDescription -and
        (Resolve-PrincipalSid ([string]$existing.Principal.UserId)) -eq
            "S-1-5-19" -and
        $existingActions.Count -eq 1 -and
        [string]$existingActions[0].Execute -eq $powerShell -and
        [string]$existingActions[0].WorkingDirectory -eq $ProjectRoot -and
        [string]$existingActions[0].Arguments -eq $argumentLine -and
        $existingTriggers.Count -eq 1 -and
        [string]$existingTriggers[0].CimClass.CimClassName -eq
            "MSFT_TaskDailyTrigger"
    )
    if (-not $knownTask) {
        throw "An unowned scheduled task already uses the exchange-rate task name"
    }
    if ([string]$existing.State -eq "Running") {
        throw "The exchange-rate task is running; retry after it finishes"
    }
}

$registrationTarget = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
if ($null -ne $registrationTarget) {
    if (
        $null -eq $existing -or
        [string]$registrationTarget.Description -ne $taskDescription -or
        (Resolve-PrincipalSid (
            [string]$registrationTarget.Principal.UserId
        )) -ne "S-1-5-19" -or
        [string]$registrationTarget.State -eq "Running"
    ) {
        throw "The exchange-rate task changed after ownership verification"
    }
}
elseif ($null -ne $existing) {
    throw "The approved exchange-rate task disappeared before registration"
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath "\" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $taskDescription `
    -Force | Out-Null

$installed = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction Stop
$installedActions = @($installed.Actions)
$installedTriggers = @($installed.Triggers)
if (
    [string]$installed.Description -ne $taskDescription -or
    (Resolve-PrincipalSid ([string]$installed.Principal.UserId)) -ne
        "S-1-5-19" -or
    $installedActions.Count -ne 1 -or
    [string]$installedActions[0].Execute -ne $powerShell -or
    [string]$installedActions[0].WorkingDirectory -ne $ProjectRoot -or
    [string]$installedActions[0].Arguments -ne $argumentLine -or
    $installedTriggers.Count -ne 1 -or
    [string]$installedTriggers[0].CimClass.CimClassName -ne
        "MSFT_TaskDailyTrigger"
) {
    throw "Exchange-rate scheduled task verification failed"
}

Write-Host "Exchange-rate scheduled task: READY"
Write-Host "Principal: LocalService (S-1-5-19)"
