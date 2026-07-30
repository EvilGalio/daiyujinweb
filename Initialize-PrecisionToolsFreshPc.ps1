[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$BackendPython = "",
    [string]$OccPython = (
        "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
    ),
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
    [string]$RuntimeRoot = (
        "C:\ProgramData\Daiyujin\PrecisionTools\runtime"
    ),
    [string]$ReferenceDataRoot = (
        "C:\daiyujin\daiyujin-platform-private\assets\precision-tools-reference-data"
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

function Get-CsvSecret {
    param([object[]]$Rows, [string]$Key, [int]$MinimumLength = 1)
    $matches = @($Rows | Where-Object { [string]$_.key -ceq $Key })
    if ($matches.Count -ne 1) {
        throw "Fresh-PC secrets CSV must contain exactly one $Key row"
    }
    $value = ([string]$matches[0].value).Trim()
    if ($value.Length -lt $MinimumLength -or $value -match "[\r\n]") {
        throw "Fresh-PC secret is missing or malformed: $Key"
    }
    return $value
}

function Set-RestrictedDataDirectoryAcl {
    param(
        [string]$Path,
        [string]$ContainmentRoot
    )
    $resolved = Assert-PrecisionToolsTrustedMutationAncestors `
        -Path $Path `
        -Root $ContainmentRoot `
        -Label "Precision Tools initialization data directory" `
        -DeploymentOperatorSid $sourceOperatorSid
    [void](New-Item -ItemType Directory -Path $resolved -Force)
    [void](Assert-PrecisionToolsPathContained `
        -Path $resolved `
        -Root $ContainmentRoot `
        -Label "Precision Tools initialization data directory")
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $full = [Security.AccessControl.FileSystemRights]::FullControl
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    $propagation = [Security.AccessControl.PropagationFlags]::None
    foreach ($sidValue in @(
        "S-1-5-18",
        "S-1-5-32-544",
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    ) | Select-Object -Unique) {
        $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                $full,
                $inheritance,
                $propagation,
                $allow
            )
        )
    }
    Set-Acl -LiteralPath $resolved -AclObject $acl
    [void](Assert-PrecisionToolsPathContained `
        -Path $resolved `
        -Root $ContainmentRoot `
        -Label "Precision Tools initialization data directory")
}

if (-not (Test-Administrator)) {
    throw "Precision Tools fresh-PC initialization must run from elevated PowerShell"
}
$scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = $scriptRoot
}
if (-not [IO.Path]::GetFullPath($ProjectRoot).Equals(
    $scriptRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Fresh-PC initialization requires the script's source root"
}
$root = (Resolve-Path -LiteralPath $scriptRoot).Path
$environmentCommon = Join-Path $root "PrecisionToolsEnvironment.Common.ps1"
$sourceOperatorSid = [string](Assert-PrecisionToolsBootstrapSource `
    -SourceRoot $root `
    -CommonPath $environmentCommon)
. $environmentCommon
$root = Assert-PrecisionToolsPathContained `
    -Path $root `
    -Root $root `
    -Label "Precision Tools project root"
$envPath = Assert-PrecisionToolsFixedEnvironmentPath -Path $EnvironmentFile
$legacyRepositoryEnvironment = Join-Path $root "backend\.env"
if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $BackendPython = Join-Path $root ".venv\Scripts\python.exe"
}
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
if (-not (Test-Path -LiteralPath $SecretsCsvPath -PathType Leaf)) {
    throw "Required fresh-PC input not found: $SecretsCsvPath"
}
$backendRoot = Join-Path $root "backend"
$dataRoot = Assert-PrecisionToolsPathContained `
    -Path (Join-Path $backendRoot "data") `
    -Root $backendRoot `
    -Label "Precision Tools initialization data directory"
$runtimeDataRoots = @(
    $dataRoot,
    (Join-Path $backendRoot "private\order_media"),
    (Join-Path $backendRoot "private\nextgen_handoff"),
    (Join-Path $backendRoot "uploads"),
    (Join-Path $backendRoot "static\thumbnails"),
    (Join-Path $backendRoot "static\stl")
)
for ($index = 1; $index -lt $runtimeDataRoots.Count; $index++) {
    $runtimeDataRoots[$index] = Assert-PrecisionToolsPathContained `
        -Path $runtimeDataRoots[$index] `
        -Root $backendRoot `
        -Label "Precision Tools empty-environment runtime directory"
}
$databasePath = Join-Path $dataRoot "daiyujin.db"
$runtimeAclScript = Join-Path $root "Set-PrecisionToolsRuntimeAcl.ps1"
$materializeScript = Join-Path $root "backend\scripts\materialize_reference_data.py"
$seedScript = Join-Path $root "backend\scripts\seed_data.py"
$verifySeedScript = Join-Path $root "backend\scripts\verify_fresh_pc_seed.py"
if (-not (Test-Path -LiteralPath $runtimeAclScript -PathType Leaf)) {
    throw "Precision Tools runtime ACL script was not found: $runtimeAclScript"
}
if (-not (Test-Path -LiteralPath $materializeScript -PathType Leaf)) {
    throw "Precision Tools reference-data materializer was not found: $materializeScript"
}
$ReferenceDataRoot = [IO.Path]::GetFullPath($ReferenceDataRoot)
Assert-PrecisionToolsNoReparsePoints -Path $runtimeAclScript
Assert-PrecisionToolsNoReparsePoints -Path $materializeScript
Assert-PrecisionToolsNoReparsePoints -Path $ReferenceDataRoot
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $runtimeAclScript `
    -SourceRoot $root `
    -Label "Precision Tools runtime ACL script" `
    -DeploymentOperatorSid $sourceOperatorSid)
foreach ($sourcePath in @($materializeScript, $seedScript, $verifySeedScript)) {
    [void](Assert-PrecisionToolsTrustedSourceFile `
        -Path $sourcePath `
        -SourceRoot $root `
        -Label "Precision Tools initialization source" `
        -DeploymentOperatorSid $sourceOperatorSid)
}
$referenceManifest = Join-Path $ReferenceDataRoot "manifest.json"
[void](Assert-PrecisionToolsTrustedSourceFile `
    -Path $referenceManifest `
    -SourceRoot $ReferenceDataRoot `
    -Label "Precision Tools reference-data manifest" `
    -DeploymentOperatorSid $sourceOperatorSid)
$powerShellRoot = Join-Path (
    [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
) "System32"
$powerShell = Assert-PrecisionToolsTrustedExecutable `
    -Path (Join-Path $powerShellRoot "WindowsPowerShell\v1.0\powershell.exe") `
    -AllowedRoots @($powerShellRoot) `
    -Label "Windows PowerShell"

Write-Host "Precision Tools empty-environment initialization plan"
Write-Host "  Project: $root"
Write-Host "  Database: $databasePath"
Write-Host "  EnvironmentFile: $envPath"
Write-Host "  Reference data: $ReferenceDataRoot"
Write-Host "  Existing database: $(Test-Path -LiteralPath $databasePath -PathType Leaf)"
Write-Host "  No existing database or upload will be deleted."
if ($Confirmation -cne "INITIALIZE_PRECISION_TOOLS_EMPTY_DATA") {
    Write-Host "Plan only. Re-run with -Confirmation INITIALIZE_PRECISION_TOOLS_EMPTY_DATA"
    exit 0
}
$existingRuntimeItems = @(
    foreach ($runtimeDataRoot in $runtimeDataRoots) {
        if (Test-Path -LiteralPath $runtimeDataRoot) {
            Assert-PrecisionToolsNoReparsePoints -Path $runtimeDataRoot
            $runtimeRootItem = Get-Item -LiteralPath $runtimeDataRoot `
                -Force -ErrorAction Stop
            if ($runtimeRootItem.PSIsContainer) {
                Get-ChildItem -LiteralPath $runtimeDataRoot -Force `
                    -ErrorAction Stop
            }
            else {
                $runtimeRootItem
            }
        }
    }
)
if (
    (Test-Path -LiteralPath $databasePath -PathType Leaf) -or
    (Test-Path -LiteralPath $envPath -PathType Leaf) -or
    $existingRuntimeItems.Count -gt 0
) {
    throw (
        "Precision Tools runtime data or environment already exists. " +
        "Use the reviewed update, recovery, or restore path."
    )
}
if (Test-Path -LiteralPath $legacyRepositoryEnvironment) {
    throw "Production initialization refuses repository-local backend\.env"
}
if (
    -not (Test-Path -LiteralPath $ReferenceDataRoot -PathType Container) -or
    -not (Test-Path -LiteralPath (
        Join-Path $ReferenceDataRoot "manifest.json"
    ) -PathType Leaf)
) {
    throw "Private Precision Tools reference-data package was not found"
}

& $powerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $runtimeAclScript `
    -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath)) `
    -ValidateSecretsOnly
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools operator secrets CSV ACL validation failed"
}

$rows = @(Import-Csv -LiteralPath $SecretsCsvPath -Encoding UTF8)
$secretKey = Get-CsvSecret $rows "PRECISION_TOOLS_SECRET_KEY" 32
$adminSecretKey = Get-CsvSecret $rows "PRECISION_TOOLS_ADMIN_SECRET_KEY" 32
$adminPassword = Get-CsvSecret $rows "PRECISION_TOOLS_ADMIN_PASSWORD" 24
$backupPassword = Get-CsvSecret $rows "PRECISION_TOOLS_BACKUP_PASSWORD" 24
$quoteSigningSecret = Get-CsvSecret $rows "QUOTE_HANDOFF_SIGNING_SECRET" 32
$bridgeSecret = Get-CsvSecret $rows "NEXTGEN_LEGACY_HANDOFF_SECRET" 32

$initializationSucceeded = $false
$environmentCreated = $false
try {
Set-RestrictedDataDirectoryAcl `
    -Path $dataRoot `
    -ContainmentRoot $backendRoot
& $BackendPython -E -B $materializeScript `
    --reference-root $ReferenceDataRoot `
    --data-root $dataRoot | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "Precision Tools reference-data materialization failed"
}
$envLines = @(
    "BACKEND_PYTHON=$([IO.Path]::GetFullPath($BackendPython))",
    "OCC_PYTHON=$([IO.Path]::GetFullPath($OccPython))",
    "SECRET_KEY=$secretKey",
    "ADMIN_SECRET_KEY=$adminSecretKey",
    "QUOTE_HANDOFF_SIGNING_SECRET=$quoteSigningSecret",
    "NEXTGEN_LEGACY_HANDOFF_SECRET=$bridgeSecret",
    "NEXTGEN_API_BASE_URL=http://127.0.0.1:5400/api/v2",
    "NEXTGEN_COMPANY_CODE=daiyujin",
    "NEXTGEN_CUSTOMER_PORTAL_URL=https://portal.daiyujin.dpdns.org",
    (
        "NEXTGEN_HANDOFF_STAGING_ROOT=" +
        "C:\daiyujin\daiyujinweb\backend\private\nextgen_handoff"
    ),
    (
        "ALLOWED_ORIGINS=" +
        "https://mfg-solution.com," +
        "https://www.mfg-solution.com," +
        "https://gcnov.com," +
        "https://www.gcnov.com," +
        "https://gcindus.com," +
        "https://www.gcindus.com," +
        "https://daiyujin.dpdns.org"
    ),
    "QUOTE_ASYNC_ARCHIVES_ENABLED=0",
    "QUOTE_CAD_CONCURRENCY=2"
)
Write-PrecisionToolsEnvironmentFileAtomic `
    -Path $envPath `
    -Lines $envLines `
    -RequireNew
$environmentCreated = $true
Import-PrecisionToolsEnvironmentFile -Path $envPath -Production

    & $powerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $runtimeAclScript `
        -ProjectRoot $root `
        -OccPython ([IO.Path]::GetFullPath($OccPython)) `
        -RuntimeRoot ([IO.Path]::GetFullPath($RuntimeRoot)) `
        -EnvironmentFile $envPath `
        -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools LocalService runtime ACL configuration failed"
    }

    $env:PRECISION_TOOLS_ADMIN_PASSWORD = $adminPassword
    & $BackendPython -E -B $seedScript | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools data seed failed"
    }
    & $BackendPython -E -B $verifySeedScript `
        --reference-root $ReferenceDataRoot | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools fresh-PC seed verification failed"
    }
    $initializationSucceeded = $true
}
finally {
    Remove-Item Env:PRECISION_TOOLS_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    foreach ($secretEnvironmentKey in @(
        "SECRET_KEY",
        "ADMIN_SECRET_KEY",
        "QUOTE_HANDOFF_SIGNING_SECRET",
        "NEXTGEN_LEGACY_HANDOFF_SECRET"
    )) {
        Remove-Item "Env:$secretEnvironmentKey" -ErrorAction SilentlyContinue
    }
    $adminPassword = $null
    $backupPassword = $null
    if (-not $initializationSucceeded) {
        if ($environmentCreated) {
            [void](Assert-PrecisionToolsFixedEnvironmentPath -Path $envPath)
            Assert-PrecisionToolsNoReparsePoints -Path $envPath
            Remove-Item -LiteralPath $envPath -Force -ErrorAction SilentlyContinue
        }
        $expectedDataRoot = [IO.Path]::GetFullPath(
            (Join-Path $root "backend\data")
        )
        if (-not [IO.Path]::GetFullPath($dataRoot).Equals(
            $expectedDataRoot,
            [StringComparison]::OrdinalIgnoreCase
        )) {
            throw "Refusing to clean an unexpected Precision Tools data path"
        }
        if (Test-Path -LiteralPath $dataRoot -PathType Container) {
            [void](Assert-PrecisionToolsPathContained `
                -Path $dataRoot `
                -Root $backendRoot `
                -Label "Precision Tools cleanup data directory")
            Remove-Item -LiteralPath $dataRoot -Recurse -Force
        }
    }
}

Write-Host "Precision Tools empty environment: READY"
Write-Host "The generated administrator password remains only in the external CSV."
