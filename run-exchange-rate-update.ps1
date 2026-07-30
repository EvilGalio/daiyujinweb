[CmdletBinding()]
param(
    [string]$BackendPython = "",
    [string]$EnvironmentFile = "",
    [string]$LogPath = "",
    [string]$DeploymentOperatorSid = "",
    [switch]$Development
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

$ProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$BackendRoot = Join-Path $ProjectRoot "backend"
$environmentCommon = Join-Path $ProjectRoot "PrecisionToolsEnvironment.Common.ps1"
$sourceOperatorSid = [string](Assert-PrecisionToolsBootstrapSource `
    -SourceRoot $ProjectRoot `
    -CommonPath $environmentCommon `
    -ExpectedOperatorSid $DeploymentOperatorSid)
. $environmentCommon
$ProjectRoot = Assert-PrecisionToolsPathContained `
    -Path $ProjectRoot `
    -Root $ProjectRoot `
    -Label "Precision Tools project root"
if ($Development) {
    if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
        $EnvironmentFile = Join-Path $BackendRoot ".env"
    }
    Import-PrecisionToolsEnvironmentFile `
        -Path $EnvironmentFile `
        -AllowMissing
    if ([string]::IsNullOrWhiteSpace($LogPath)) {
        $LogPath = Join-Path $ProjectRoot "exchange-rate-update.log"
    }
}
else {
    if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
        throw "Production exchange-rate launch requires explicit -EnvironmentFile"
    }
    Import-PrecisionToolsEnvironmentFile `
        -Path $EnvironmentFile `
        -Production `
        -Profile ExchangeRate
    if ([string]::IsNullOrWhiteSpace($LogPath)) {
        throw "Production exchange-rate launch requires explicit -LogPath"
    }
    if ([string]::IsNullOrWhiteSpace($BackendPython)) {
        throw "Production exchange-rate launch requires explicit -BackendPython"
    }
}

if ($Development) {
    if ([string]::IsNullOrWhiteSpace($BackendPython)) {
        $BackendPython = $env:BACKEND_PYTHON
    }
    if ([string]::IsNullOrWhiteSpace($BackendPython)) {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($pythonCommand) {
            $BackendPython = $pythonCommand.Source
        }
    }
    if (
        [string]::IsNullOrWhiteSpace($BackendPython) -or
        -not [IO.Path]::IsPathRooted($BackendPython) -or
        -not (Test-Path -LiteralPath $BackendPython -PathType Leaf)
    ) {
        throw "BACKEND_PYTHON must be a usable absolute path"
    }
    $BackendPython = (Resolve-Path -LiteralPath $BackendPython).Path
}
else {
    $expectedBackendPython = [IO.Path]::GetFullPath(
        (Join-Path $ProjectRoot ".venv\Scripts\python.exe")
    )
    $requestedBackendPython = [IO.Path]::GetFullPath($BackendPython)
    if (
        -not $requestedBackendPython.Equals(
            $expectedBackendPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not ([IO.Path]::GetFullPath($env:BACKEND_PYTHON)).Equals(
            $expectedBackendPython,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Production exchange-rate Python does not match the protected contract"
    }
    $BackendPython = Assert-PrecisionToolsTrustedExecutable `
        -Path $requestedBackendPython `
        -AllowedRoots @((Join-Path $ProjectRoot ".venv")) `
        -Label "Precision Tools backend Python" `
        -DeploymentOperatorSid $sourceOperatorSid
}

$LogPath = [IO.Path]::GetFullPath($LogPath)
if (-not $Development) {
    $LogPath = Assert-PrecisionToolsPathContained `
        -Path $LogPath `
        -Root "C:\ProgramData\Daiyujin\PrecisionTools\runtime\logs" `
        -Label "Precision Tools exchange-rate log"
}
$logParent = Split-Path -Parent $LogPath
if (-not (Test-Path -LiteralPath $logParent -PathType Container)) {
    if (-not $Development) {
        throw "Production exchange-rate log directory was not prepared"
    }
    [void](New-Item -ItemType Directory -Path $logParent -Force)
}

$dbPath = (Join-Path $BackendRoot "data\daiyujin.db").Replace("\", "/")
$env:DATABASE_URL = "sqlite:///$dbPath"
$env:BACKEND_PYTHON = $BackendPython

Set-Location -LiteralPath $BackendRoot
$updateScript = Join-Path $BackendRoot "scripts\update_exchange_rates.py"
if (-not $Development) {
    [void](Assert-PrecisionToolsTrustedSourceFile `
        -Path $updateScript `
        -SourceRoot $ProjectRoot `
        -Label "Precision Tools exchange-rate source" `
        -DeploymentOperatorSid $sourceOperatorSid)
}
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -LiteralPath $LogPath -Value "[$stamp] Starting exchange-rate update"

& $BackendPython -E -B $updateScript *>&1 |
    Tee-Object -FilePath $LogPath -Append

if ($LASTEXITCODE -ne 0) {
    throw "Exchange-rate update failed with code $LASTEXITCODE. See $LogPath"
}
