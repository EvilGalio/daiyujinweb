[CmdletBinding()]
param(
    [ValidateSet("Daily", "Weekly", "Monthly")]
    [string]$Mode = "Daily",
    [string]$ProjectRoot = "C:\daiyujin\daiyujinweb",
    [string]$RuntimeBundleRoot = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-runtime",
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [Parameter(Mandatory = $true)]
    [string]$OperatorSid
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:SystemSid = "S-1-5-18"
$script:AdministratorsSid = "S-1-5-32-544"
$script:LocalServiceSid = "S-1-5-19"
$script:ExpectedProjectRoot = "C:\daiyujin\daiyujinweb"
$script:ExpectedRuntimeBundleRoot = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-runtime"
$script:ExpectedEnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env"
$script:ExpectedSecretsCsvPath = (
    "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
)
$script:RuntimeManifestName = "bundle-manifest.json"
$script:RuntimeContract = "daiyujin-precision-tools-backup-runtime-v1"

function Assert-ExactPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (
        [string]::IsNullOrWhiteSpace($Path) -or
        -not [IO.Path]::IsPathRooted($Path)
    ) {
        throw "$Label must be an absolute path"
    }
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullExpected = [IO.Path]::GetFullPath($Expected)
    if (-not $fullPath.Equals(
        $fullExpected,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "$Label must use the fixed reviewed path: $fullExpected"
    }
    return $fullPath
}

function Assert-NoReparseComponents {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $fullPath = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($fullPath)
    $current = $root
    foreach ($segment in $fullPath.Substring($root.Length).Split(
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
            throw "$Label contains a reparse point: $current"
        }
    }
}

function Get-OwnerSid {
    param([Parameter(Mandatory = $true)][object]$Acl)
    return $Acl.GetOwner(
        [Security.Principal.SecurityIdentifier]
    ).Value
}

function Assert-ExactProtectedAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$ExpectedRights,
        [Parameter(Mandatory = $true)][string]$Label,
        [switch]$RequireProtected
    )
    Assert-NoReparseComponents -Path $Path -Label $Label
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if ($RequireProtected -and -not $acl.AreAccessRulesProtected) {
        throw "$Label ACL inheritance must be disabled"
    }
    if ((Get-OwnerSid -Acl $acl) -ne $script:AdministratorsSid) {
        throw "$Label owner must be BUILTIN\Administrators"
    }
    $observed = @{}
    foreach ($rule in $acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )) {
        $sid = [string]$rule.IdentityReference.Value
        if (
            $rule.AccessControlType -ne
                [Security.AccessControl.AccessControlType]::Allow -or
            -not $ExpectedRights.ContainsKey($sid)
        ) {
            throw "$Label grants access to an unexpected principal"
        }
        if ($RequireProtected -and $rule.IsInherited) {
            throw "$Label contains an inherited access rule"
        }
        $current = if ($observed.ContainsKey($sid)) {
            [int64]$observed[$sid]
        }
        else {
            [int64]0
        }
        $observed[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    foreach ($sid in $ExpectedRights.Keys) {
        $expected = [int64]$ExpectedRights[$sid]
        if (
            -not $observed.ContainsKey($sid) -or
            [int64]$observed[$sid] -ne $expected
        ) {
            throw "$Label has an unexpected rights contract for SID $sid"
        }
    }
}

function Get-ProtectedRuntimeItems {
    param([Parameter(Mandatory = $true)][string]$Root)
    $items = [System.Collections.Generic.List[object]]::new()
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($Root)
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "Protected backup runtime contains a reparse point: $current"
        }
        $items.Add($item)
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
                $queue.Enqueue($child.FullName)
            }
        }
    }
    return $items.ToArray()
}

function Get-RuntimeRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Path
    )
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith(
        $prefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Protected backup runtime item escapes its bundle root"
    }
    return $fullPath.Substring($prefix.Length).Replace("\", "/")
}

function Assert-ProtectedRuntimeBundle {
    param([Parameter(Mandatory = $true)][string]$Root)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "Protected backup runtime bundle was not found: $Root"
    }
    Assert-NoReparseComponents -Path $Root -Label "Protected backup runtime"

    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    $runtimeRights = @{
        $script:SystemSid = $full
        $script:AdministratorsSid = $full
    }
    Assert-ExactProtectedAcl -Path $Root -ExpectedRights $runtimeRights `
        -Label "Protected backup runtime root" -RequireProtected

    $items = @(Get-ProtectedRuntimeItems -Root $Root)
    foreach ($item in $items | Select-Object -Skip 1) {
        Assert-ExactProtectedAcl -Path $item.FullName `
            -ExpectedRights $runtimeRights `
            -Label "Protected backup runtime item"
    }

    $manifestPath = Join-Path $Root $script:RuntimeManifestName
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Protected backup runtime manifest was not found"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    if ([string]$manifest.contract -cne $script:RuntimeContract) {
        throw "Protected backup runtime manifest contract is invalid"
    }
    $declared = @{}
    foreach ($entry in @($manifest.files)) {
        $relative = ([string]$entry.path).Replace("\", "/")
        if (
            [string]::IsNullOrWhiteSpace($relative) -or
            $relative.StartsWith("/") -or
            $relative -match "(^|/)\.\.?(/|$)" -or
            $relative -match ":"
        ) {
            throw "Protected backup runtime manifest contains an unsafe path"
        }
        if ($relative -ceq $script:RuntimeManifestName) {
            throw "Protected backup runtime manifest cannot list itself"
        }
        if ($declared.ContainsKey($relative)) {
            throw "Protected backup runtime manifest contains a duplicate path"
        }
        $declared[$relative] = [string]$entry.sha256
    }

    $actual = @{}
    foreach ($item in $items | Where-Object { -not $_.PSIsContainer }) {
        $relative = Get-RuntimeRelativePath -Root $Root -Path $item.FullName
        if ($relative -ceq $script:RuntimeManifestName) {
            continue
        }
        $actual[$relative] = $item.FullName
    }
    if ($actual.Count -ne $declared.Count) {
        throw "Protected backup runtime file set differs from its manifest"
    }
    foreach ($relative in $declared.Keys) {
        if (-not $actual.ContainsKey($relative)) {
            throw "Protected backup runtime manifest references a missing file"
        }
        $expectedHash = [string]$declared[$relative]
        if ($expectedHash -notmatch "^[0-9a-f]{64}$") {
            throw "Protected backup runtime manifest contains an invalid hash"
        }
        $actualHash = (
            Get-FileHash -LiteralPath $actual[$relative] -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($actualHash -cne $expectedHash) {
            throw "Protected backup runtime hash mismatch: $relative"
        }
    }
    Assert-NoReparseComponents -Path $Root -Label "Protected backup runtime"
}

function Assert-ProtectedSecretsCsv {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedOperatorSid
    )
    try {
        $operator = [Security.Principal.SecurityIdentifier]::new(
            $ExpectedOperatorSid
        )
    }
    catch {
        throw "OperatorSid is not a valid Windows SID"
    }
    if ($operator.Value -in @($script:SystemSid, $script:AdministratorsSid)) {
        throw "OperatorSid must identify the interactive operator"
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Protected secrets CSV was not found: $Path"
    }
    $rights = @{
        $script:SystemSid = [int64][Security.AccessControl.FileSystemRights]::FullControl
        $script:AdministratorsSid = [int64][Security.AccessControl.FileSystemRights]::FullControl
        $operator.Value = [int64](
            [Security.AccessControl.FileSystemRights]::Modify -bor
            [Security.AccessControl.FileSystemRights]::Synchronize
        )
    }
    Assert-ExactProtectedAcl -Path $Path -ExpectedRights $rights `
        -Label "Precision Tools operator secrets CSV" -RequireProtected
}

function Assert-ProtectedEnvironmentFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Precision Tools external environment file was not found"
    }
    $rights = @{
        $script:SystemSid = [int64][Security.AccessControl.FileSystemRights]::FullControl
        $script:AdministratorsSid = [int64][Security.AccessControl.FileSystemRights]::FullControl
        $script:LocalServiceSid = [int64](
            [Security.AccessControl.FileSystemRights]::Read -bor
            [Security.AccessControl.FileSystemRights]::Synchronize
        )
    }
    Assert-ExactProtectedAcl -Path $Path -ExpectedRights $rights `
        -Label "Precision Tools production environment" -RequireProtected
}

function Get-CsvSecret {
    param([string]$Path, [string]$Key, [int]$MinimumLength = 32)
    $matches = @(
        Import-Csv -LiteralPath $Path -Encoding UTF8 |
            Where-Object { [string]$_.key -ceq $Key }
    )
    if ($matches.Count -ne 1) {
        throw "Protected secrets CSV must contain exactly one $Key row"
    }
    $value = [string]$matches[0].value
    if (
        [string]::IsNullOrWhiteSpace($value) -or
        $value.Length -lt $MinimumLength -or
        $value -match "[\r\n]"
    ) {
        throw "Protected backup secret is missing or malformed"
    }
    return $value
}

$root = Assert-ExactPath -Path $ProjectRoot `
    -Expected $script:ExpectedProjectRoot -Label "ProjectRoot"
$runtime = Assert-ExactPath -Path $RuntimeBundleRoot `
    -Expected $script:ExpectedRuntimeBundleRoot -Label "RuntimeBundleRoot"
$environment = Assert-ExactPath -Path $EnvironmentFile `
    -Expected $script:ExpectedEnvironmentFile -Label "EnvironmentFile"
$secretsCsv = Assert-ExactPath -Path $SecretsCsvPath `
    -Expected $script:ExpectedSecretsCsvPath -Label "SecretsCsvPath"
$scriptDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $scriptDirectory.Equals(
    $runtime,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Protected backup wrapper may run only from the fixed runtime bundle"
}
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    throw "Fixed Precision Tools project root was not found: $root"
}

Assert-ProtectedRuntimeBundle -Root $runtime
Assert-ProtectedSecretsCsv -Path $secretsCsv `
    -ExpectedOperatorSid $OperatorSid
Assert-ProtectedEnvironmentFile -Path $environment

$runtimePython = Join-Path $runtime ".venv\Scripts\python.exe"
$backupScript = Join-Path $runtime "Backup-OrderPortal.ps1"
$backupOutput = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-output\order_portal"
foreach ($path in @($runtimePython, $backupScript)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Protected backup runtime input was not found: $path"
    }
}

$backupPassword = Get-CsvSecret -Path $secretsCsv `
    -Key "PRECISION_TOOLS_BACKUP_PASSWORD"
[Environment]::SetEnvironmentVariable(
    "ORDER_PORTAL_BACKUP_PASSWORD",
    $backupPassword,
    [EnvironmentVariableTarget]::Process
)
try {
    & $backupScript -Mode $Mode -ProjectRoot $root `
        -PythonExe $runtimePython -EnvironmentFile $environment `
        -OperatorSid $OperatorSid -BackupRoot $backupOutput
}
finally {
    Remove-Item Env:ORDER_PORTAL_BACKUP_PASSWORD -ErrorAction Stop
    if ($null -ne [Environment]::GetEnvironmentVariable(
        "ORDER_PORTAL_BACKUP_PASSWORD",
        [EnvironmentVariableTarget]::Process
    )) {
        throw "Protected backup password environment cleanup failed"
    }
    $backupPassword = $null
}

Write-Host "Precision Tools protected $Mode backup: PASS"
