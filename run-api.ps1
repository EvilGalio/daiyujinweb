[CmdletBinding()]
param(
    [string]$BackendPython = "",
    [string]$OccPython = "",
    [string]$RuntimeTempRoot = "",
    [string]$EnvironmentFile = "",
    [string]$DeploymentOperatorSid = "",
    [switch]$Development,
    [int]$ApiPort = 5000
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

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
}
else {
    if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
        throw "Production API launch requires explicit -EnvironmentFile"
    }
    Import-PrecisionToolsEnvironmentFile `
        -Path $EnvironmentFile `
        -Production `
        -Profile Api
    if (
        [string]::IsNullOrWhiteSpace($BackendPython) -or
        [string]::IsNullOrWhiteSpace($OccPython) -or
        [string]::IsNullOrWhiteSpace($RuntimeTempRoot)
    ) {
        throw "Production API launch requires explicit Python runtimes and temp root"
    }
    if ($ApiPort -ne 5000) {
        throw "Production API launch requires loopback port 5000"
    }
}

function Resolve-PythonPath {
    param(
        [string]$RequestedPath,
        [string]$EnvironmentName,
        [string[]]$FallbackPaths,
        [string]$ProbeCode = ""
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $candidates += $RequestedPath
    }
    $configured = [Environment]::GetEnvironmentVariable($EnvironmentName, "Process")
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        $candidates += $configured
    }
    $candidates += $FallbackPaths

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $resolved = (Resolve-Path -LiteralPath $candidate).Path
            if ($ProbeCode) {
                & $resolved -B -c $ProbeCode 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    continue
                }
            }
            return $resolved
        }
    }

    throw "$EnvironmentName is not configured. Set an absolute path in EnvironmentFile or pass the matching script parameter."
}

if (-not [string]::IsNullOrWhiteSpace($RuntimeTempRoot)) {
    $RuntimeTempRoot = [IO.Path]::GetFullPath($RuntimeTempRoot)
    if (-not $Development) {
        $RuntimeTempRoot = Assert-PrecisionToolsPathContained `
            -Path $RuntimeTempRoot `
            -Root "C:\ProgramData\Daiyujin\PrecisionTools\runtime\temp" `
            -Label "Precision Tools API temporary directory"
    }
    if (-not (Test-Path -LiteralPath $RuntimeTempRoot -PathType Container)) {
        throw "Precision Tools API runtime temp directory was not prepared"
    }
    $env:TEMP = $RuntimeTempRoot
    $env:TMP = $RuntimeTempRoot
}

if ($Development) {
    $commonPythonPaths = @(
        (Join-Path $ProjectRoot ".venv\Scripts\python.exe"),
        (Join-Path $BackendRoot ".venv\Scripts\python.exe"),
        (Join-Path $env:USERPROFILE "miniconda3\envs\occ\python.exe"),
        (Join-Path $env:USERPROFILE "anaconda3\envs\occ\python.exe"),
        (Join-Path $env:ProgramFiles "Python313\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        "D:\anaconda\envs\occ\python.exe",
        "D:\anaconda\python.exe"
    )
    $BackendPython = Resolve-PythonPath `
        -RequestedPath $BackendPython `
        -EnvironmentName "BACKEND_PYTHON" `
        -FallbackPaths $commonPythonPaths
    $OccPython = Resolve-PythonPath `
        -RequestedPath $OccPython `
        -EnvironmentName "OCC_PYTHON" `
        -FallbackPaths (@($BackendPython) + $commonPythonPaths) `
        -ProbeCode "from OCC.Core.BRep import BRep_Tool"
}
else {
    $expectedBackendPython = [IO.Path]::GetFullPath(
        (Join-Path $ProjectRoot ".venv\Scripts\python.exe")
    )
    $expectedOccPython = [IO.Path]::GetFullPath(
        "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
    )
    $requestedBackendPython = [IO.Path]::GetFullPath($BackendPython)
    $requestedOccPython = [IO.Path]::GetFullPath($OccPython)
    if (
        -not $requestedBackendPython.Equals(
            $expectedBackendPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not $requestedOccPython.Equals(
            $expectedOccPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not ([IO.Path]::GetFullPath($env:BACKEND_PYTHON)).Equals(
            $expectedBackendPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not ([IO.Path]::GetFullPath($env:OCC_PYTHON)).Equals(
            $expectedOccPython,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Production API Python runtimes do not match the protected contract"
    }
    $BackendPython = Assert-PrecisionToolsTrustedExecutable `
        -Path $requestedBackendPython `
        -AllowedRoots @((Join-Path $ProjectRoot ".venv")) `
        -Label "Precision Tools backend Python" `
        -DeploymentOperatorSid $sourceOperatorSid
    $OccPython = Assert-PrecisionToolsTrustedExecutable `
        -Path $requestedOccPython `
        -AllowedRoots @("C:\ProgramData\Daiyujin\Dependencies") `
        -Label "Precision Tools OCC Python" `
        -DeploymentOperatorSid $sourceOperatorSid
}

$dbPath = (Join-Path $BackendRoot "data\daiyujin.db").Replace("\", "/")
$env:DATABASE_URL = "sqlite:///$dbPath"
$env:BACKEND_PYTHON = $BackendPython
$env:OCC_PYTHON = $OccPython
if ([string]::IsNullOrWhiteSpace($env:QUOTE_ASYNC_ARCHIVES_ENABLED)) {
    $env:QUOTE_ASYNC_ARCHIVES_ENABLED = "0"
}
if ([string]::IsNullOrWhiteSpace($env:QUOTE_CAD_CONCURRENCY)) {
    $env:QUOTE_CAD_CONCURRENCY = "2"
}
$defaultAllowedOrigins = @(
    "https://mfg-solution.com",
    "https://www.mfg-solution.com",
    "https://gcnov.com",
    "https://www.gcnov.com",
    "https://gcindus.com",
    "https://www.gcindus.com",
    "https://daiyujin.dpdns.org"
)
if ([string]::IsNullOrWhiteSpace($env:ALLOWED_ORIGINS)) {
    $env:ALLOWED_ORIGINS = $defaultAllowedOrigins -join ","
}
$validatedAllowedOrigins = @()
foreach ($configuredOrigin in $env:ALLOWED_ORIGINS.Split(",")) {
    $origin = $configuredOrigin.Trim()
    $parsedOrigin = $null
    if (
        [string]::IsNullOrWhiteSpace($origin) -or
        $origin.Contains("*") -or
        $origin -match "\s" -or
        -not [Uri]::TryCreate(
            $origin,
            [UriKind]::Absolute,
            [ref]$parsedOrigin
        ) -or
        $parsedOrigin.Scheme -cne "https" -or
        [string]::IsNullOrWhiteSpace($parsedOrigin.Host) -or
        $parsedOrigin.IsLoopback -or
        $parsedOrigin.IdnHost -notmatch (
            "^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$"
        ) -or
        $parsedOrigin.IdnHost.Contains("..") -or
        $parsedOrigin.UserInfo -or
        $parsedOrigin.AbsolutePath -ne "/" -or
        $parsedOrigin.Query -or
        $parsedOrigin.Fragment -or
        $origin -cnotin @(
            $parsedOrigin.GetLeftPart([UriPartial]::Authority),
            $parsedOrigin.GetLeftPart([UriPartial]::Authority) + "/"
        )
    ) {
        throw "ALLOWED_ORIGINS must contain only explicit HTTPS origins"
    }
    $validatedAllowedOrigins += $parsedOrigin.GetLeftPart(
        [UriPartial]::Authority
    )
}
$validatedAllowedOrigins = @($validatedAllowedOrigins | Select-Object -Unique)
if ($validatedAllowedOrigins.Count -eq 0) {
    throw "ALLOWED_ORIGINS must contain at least one HTTPS origin"
}
$env:ALLOWED_ORIGINS = $validatedAllowedOrigins -join ","

Set-Location -LiteralPath $BackendRoot

$appSource = Join-Path $BackendRoot "app.py"
if (-not $Development) {
    [void](Assert-PrecisionToolsTrustedSourceFile `
        -Path $appSource `
        -SourceRoot $ProjectRoot `
        -Label "Precision Tools API source" `
        -DeploymentOperatorSid $sourceOperatorSid)
}

& $BackendPython -E -B -c "import flask, sqlalchemy, waitress"
if ($LASTEXITCODE -ne 0) {
    throw "BACKEND_PYTHON cannot import the API dependencies. Run Update-Company-PC.ps1 to install backend\requirements.lock."
}

& $BackendPython -E -m waitress "--listen=127.0.0.1:$ApiPort" "--threads=16" "--channel-timeout=300" app:app
if ($LASTEXITCODE -ne 0) {
    throw "Waitress exited with code $LASTEXITCODE."
}
