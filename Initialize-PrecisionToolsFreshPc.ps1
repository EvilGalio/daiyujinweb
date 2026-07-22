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

function Set-RestrictedFileAcl {
    param([string]$Path)
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $full = [Security.AccessControl.FileSystemRights]::FullControl
    $read = [Security.AccessControl.FileSystemRights]::Read
    $system = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
    $administrators = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
    $operator = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new($system, $full, $allow)
    )
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            $administrators,
            $full,
            $allow
        )
    )
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new($operator, $read, $allow)
    )
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-RestrictedDataDirectoryAcl {
    param([string]$Path)
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
    Set-Acl -LiteralPath $Path -AclObject $acl
}

if (-not (Test-Administrator)) {
    throw "Precision Tools fresh-PC initialization must run from elevated PowerShell"
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $BackendPython = Join-Path $root ".venv\Scripts\python.exe"
}
foreach ($path in @($BackendPython, $OccPython, $SecretsCsvPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required fresh-PC input not found: $path"
    }
}
$dataRoot = Join-Path $root "backend\data"
$databasePath = Join-Path $dataRoot "daiyujin.db"
$envPath = Join-Path $root "backend\.env"
$runtimeAclScript = Join-Path $root "Set-PrecisionToolsRuntimeAcl.ps1"
$materializeScript = Join-Path $root "backend\scripts\materialize_reference_data.py"
if (-not (Test-Path -LiteralPath $runtimeAclScript -PathType Leaf)) {
    throw "Precision Tools runtime ACL script was not found: $runtimeAclScript"
}
if (-not (Test-Path -LiteralPath $materializeScript -PathType Leaf)) {
    throw "Precision Tools reference-data materializer was not found: $materializeScript"
}
$ReferenceDataRoot = [IO.Path]::GetFullPath($ReferenceDataRoot)

Write-Host "Precision Tools empty-environment initialization plan"
Write-Host "  Project: $root"
Write-Host "  Database: $databasePath"
Write-Host "  Reference data: $ReferenceDataRoot"
Write-Host "  Existing database: $(Test-Path -LiteralPath $databasePath -PathType Leaf)"
Write-Host "  No existing database or upload will be deleted."
if ($Confirmation -ne "INITIALIZE_PRECISION_TOOLS_EMPTY_DATA") {
    Write-Host "Plan only. Re-run with -Confirmation INITIALIZE_PRECISION_TOOLS_EMPTY_DATA"
    exit 0
}
$existingDataItems = if (Test-Path -LiteralPath $dataRoot -PathType Container) {
    @(Get-ChildItem -LiteralPath $dataRoot -Force -ErrorAction Stop)
}
else {
    @()
}
if (
    (Test-Path -LiteralPath $databasePath -PathType Leaf) -or
    (Test-Path -LiteralPath $envPath -PathType Leaf) -or
    $existingDataItems.Count -gt 0
) {
    throw (
        "Precision Tools runtime data or environment already exists. " +
        "Use the reviewed update, recovery, or restore path."
    )
}
if (
    -not (Test-Path -LiteralPath $ReferenceDataRoot -PathType Container) -or
    -not (Test-Path -LiteralPath (
        Join-Path $ReferenceDataRoot "manifest.json"
    ) -PathType Leaf)
) {
    throw "Private Precision Tools reference-data package was not found"
}

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
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
$quoteSigningSecret = Get-CsvSecret $rows "QUOTE_HANDOFF_SIGNING_SECRET" 32
$bridgeSecret = Get-CsvSecret $rows "NEXTGEN_LEGACY_HANDOFF_SECRET" 32

$initializationSucceeded = $false
try {
[void](New-Item -ItemType Directory -Path $dataRoot -Force)
Set-RestrictedDataDirectoryAcl -Path $dataRoot
& $BackendPython -B $materializeScript `
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
    "QUOTE_ASYNC_ARCHIVES_ENABLED=1",
    "QUOTE_CAD_CONCURRENCY=2"
)
$temporaryEnv = Join-Path $dataRoot (
    ".precision-tools-env.{0}.tmp" -f [Guid]::NewGuid().ToString("N")
)
try {
    [IO.File]::WriteAllLines(
        $temporaryEnv,
        $envLines,
        [Text.UTF8Encoding]::new($false)
    )
    Set-RestrictedFileAcl -Path $temporaryEnv
    Move-Item -LiteralPath $temporaryEnv -Destination $envPath
    Set-RestrictedFileAcl -Path $envPath
}
finally {
    if (Test-Path -LiteralPath $temporaryEnv -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryEnv -Force
    }
}

    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $runtimeAclScript `
        -ProjectRoot $root `
        -OccPython ([IO.Path]::GetFullPath($OccPython)) `
        -RuntimeRoot ([IO.Path]::GetFullPath($RuntimeRoot)) `
        -SecretsCsvPath ([IO.Path]::GetFullPath($SecretsCsvPath))
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools LocalService runtime ACL configuration failed"
    }

    $env:PRECISION_TOOLS_ADMIN_PASSWORD = $adminPassword
    & $BackendPython -B (Join-Path $root "backend\scripts\seed_data.py") | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools data seed failed"
    }
    & $BackendPython -B (Join-Path $root "backend\scripts\verify_fresh_pc_seed.py") `
        --reference-root $ReferenceDataRoot | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools fresh-PC seed verification failed"
    }
    $initializationSucceeded = $true
}
finally {
    Remove-Item Env:PRECISION_TOOLS_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $adminPassword = $null
    if (-not $initializationSucceeded) {
        Remove-Item -LiteralPath $envPath -Force -ErrorAction SilentlyContinue
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
            Remove-Item -LiteralPath $dataRoot -Recurse -Force
        }
    }
}

Write-Host "Precision Tools empty environment: READY"
Write-Host "The generated administrator password remains only in the external CSV."
