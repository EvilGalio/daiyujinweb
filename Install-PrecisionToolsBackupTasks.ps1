[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\daiyujin\daiyujinweb",
    [string]$BackendPython = "",
    [string]$RuntimeBundleRoot = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-runtime",
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [string]$Confirmation = ""
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
$script:ExpectedPowerShellExe = (
    "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
)
$script:RuntimeManifestName = "bundle-manifest.json"
$script:RuntimeContract = "daiyujin-precision-tools-backup-runtime-v1"

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

function Get-TreeItemsWithoutReparse {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (-not (Test-Path -LiteralPath $Root)) {
        throw "$Label was not found: $Root"
    }
    Assert-NoReparseComponents -Path $Root -Label $Label
    $items = [System.Collections.Generic.List[object]]::new()
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue([IO.Path]::GetFullPath($Root))
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "$Label contains a reparse point: $current"
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

function Get-OwnerSid {
    param([Parameter(Mandatory = $true)][object]$Acl)
    return $Acl.GetOwner(
        [Security.Principal.SecurityIdentifier]
    ).Value
}

function Assert-ExactProtectedFileAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$ExpectedRights,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label was not found: $Path"
    }
    Assert-NoReparseComponents -Path $Path -Label $Label
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (-not $acl.AreAccessRulesProtected) {
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
            $rule.IsInherited -or
            $rule.AccessControlType -ne
                [Security.AccessControl.AccessControlType]::Allow -or
            -not $ExpectedRights.ContainsKey($sid)
        ) {
            throw "$Label grants access outside its exact ACL contract"
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
        if (
            -not $observed.ContainsKey($sid) -or
            [int64]$observed[$sid] -ne [int64]$ExpectedRights[$sid]
        ) {
            throw "$Label has unexpected rights for SID $sid"
        }
    }
}

function Assert-TrustedRuntimeParent {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Protected runtime parent was not found: $Path"
    }
    Assert-NoReparseComponents -Path $Path -Label "Protected runtime parent"
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if ((Get-OwnerSid -Acl $acl) -ne $script:AdministratorsSid) {
        throw "Protected runtime parent owner must be BUILTIN\Administrators"
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
    foreach ($rule in $acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )) {
        if (
            $rule.AccessControlType -eq
                [Security.AccessControl.AccessControlType]::Allow -and
            [string]$rule.IdentityReference.Value -notin @(
                $script:SystemSid,
                $script:AdministratorsSid
            ) -and
            (([int64]$rule.FileSystemRights -band $writeRights) -ne 0)
        ) {
            throw "Protected runtime parent grants mutation rights to an untrusted principal"
        }
    }
}

function Set-ProtectedRuntimeRootAcl {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $Path)
    }
    Assert-NoReparseComponents -Path $Path -Label "Protected backup runtime"
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $administrators = [Security.Principal.SecurityIdentifier]::new(
        $script:AdministratorsSid
    )
    $acl.SetOwner($administrators)
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    foreach ($sidValue in @(
        $script:SystemSid,
        $script:AdministratorsSid
    )) {
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new($sidValue),
                [Security.AccessControl.FileSystemRights]::FullControl,
                $inheritance,
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow
            )
        )
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
    $actual = Get-Acl -LiteralPath $Path
    if (
        -not $actual.AreAccessRulesProtected -or
        (Get-OwnerSid -Acl $actual) -ne $script:AdministratorsSid
    ) {
        throw "Protected backup runtime root ACL verification failed"
    }
}

function Assert-ProtectedRuntimeTreeAcl {
    param([Parameter(Mandatory = $true)][string]$Root)
    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($item in @(Get-TreeItemsWithoutReparse `
        -Root $Root -Label "Protected backup runtime")) {
        $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
        if (
            $item.FullName.Equals(
                [IO.Path]::GetFullPath($Root),
                [StringComparison]::OrdinalIgnoreCase
            ) -and
            -not $acl.AreAccessRulesProtected
        ) {
            throw "Protected backup runtime root must disable ACL inheritance"
        }
        if ((Get-OwnerSid -Acl $acl) -ne $script:AdministratorsSid) {
            throw "Protected backup runtime item has an unexpected owner"
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
                $sid -notin @($script:SystemSid, $script:AdministratorsSid)
            ) {
                throw "Protected backup runtime item grants unexpected access"
            }
            $current = if ($observed.ContainsKey($sid)) {
                [int64]$observed[$sid]
            }
            else {
                [int64]0
            }
            $observed[$sid] = $current -bor [int64]$rule.FileSystemRights
        }
        foreach ($sid in @($script:SystemSid, $script:AdministratorsSid)) {
            if (
                -not $observed.ContainsKey($sid) -or
                [int64]$observed[$sid] -ne $full
            ) {
                throw "Protected backup runtime item is missing exact FullControl"
            }
        }
    }
}

function Get-RuntimeRelativePath {
    param([string]$Root, [string]$Path)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith(
        $prefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Runtime manifest item escapes its protected root"
    }
    return $fullPath.Substring($prefix.Length).Replace("\", "/")
}

function Write-RuntimeManifest {
    param([Parameter(Mandatory = $true)][string]$Root)
    $manifestPath = Join-Path $Root $script:RuntimeManifestName
    if (Test-Path -LiteralPath $manifestPath) {
        throw "Runtime staging manifest unexpectedly already exists"
    }
    $files = @(
        Get-TreeItemsWithoutReparse -Root $Root `
            -Label "Protected backup runtime staging" |
            Where-Object { -not $_.PSIsContainer } |
            Sort-Object FullName |
            ForEach-Object {
                [ordered]@{
                    path = Get-RuntimeRelativePath `
                        -Root $Root -Path $_.FullName
                    sha256 = (
                        Get-FileHash -LiteralPath $_.FullName `
                            -Algorithm SHA256
                    ).Hash.ToLowerInvariant()
                }
            }
    )
    [ordered]@{
        contract = $script:RuntimeContract
        created_at = (Get-Date).ToString("o")
        files = $files
    } | ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $manifestPath -Encoding UTF8
}

function Remove-ProtectedRuntimeTree {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RuntimeParent
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $parentPrefix = [IO.Path]::GetFullPath($RuntimeParent).TrimEnd("\") + "\"
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith(
        $parentPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to remove a runtime path outside its fixed parent"
    }
    [void](Get-TreeItemsWithoutReparse -Root $fullPath `
        -Label "Protected runtime cleanup target")
    Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $fullPath) {
        throw "Protected runtime cleanup did not remove: $fullPath"
    }
}

if (-not (Test-Administrator)) {
    throw "Precision Tools backup task installation requires elevated PowerShell"
}

$root = Assert-ExactPath -Path $ProjectRoot `
    -Expected $script:ExpectedProjectRoot -Label "ProjectRoot"
$runtime = Assert-ExactPath -Path $RuntimeBundleRoot `
    -Expected $script:ExpectedRuntimeBundleRoot -Label "RuntimeBundleRoot"
$environment = Assert-ExactPath -Path $EnvironmentFile `
    -Expected $script:ExpectedEnvironmentFile -Label "EnvironmentFile"
$secretsCsv = Assert-ExactPath -Path $SecretsCsvPath `
    -Expected $script:ExpectedSecretsCsvPath -Label "SecretsCsvPath"
$powerShell = [IO.Path]::GetFullPath($script:ExpectedPowerShellExe)
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    throw "Fixed Precision Tools project root was not found: $root"
}
if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $BackendPython = Join-Path $root ".venv\Scripts\python.exe"
}
$backendPythonPath = [IO.Path]::GetFullPath($BackendPython)
$expectedBackendPython = [IO.Path]::GetFullPath(
    (Join-Path $root ".venv\Scripts\python.exe")
)
if (-not $backendPythonPath.Equals(
    $expectedBackendPython,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "BackendPython must use the reviewed project virtual environment"
}

$sourceWrapper = Join-Path $root "Invoke-PrecisionToolsProtectedBackup.ps1"
$sourceBackup = Join-Path $root "Backup-OrderPortal.ps1"
$sourceRestore = Join-Path $root "Restore-OrderPortal.ps1"
$sourceArchiveHelper = Join-Path (
    Join-Path $root "backend\scripts"
) "protected_backup_archive.py"
foreach ($path in @(
    $backendPythonPath,
    $sourceWrapper,
    $sourceBackup,
    $sourceRestore,
    $sourceArchiveHelper,
    $powerShell,
    $environment,
    $secretsCsv
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required Precision Tools backup task input was not found: $path"
    }
    Assert-NoReparseComponents -Path $path -Label "Backup task input"
}

$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$full = [int64][Security.AccessControl.FileSystemRights]::FullControl
Assert-ExactProtectedFileAcl -Path $secretsCsv -Label (
    "Precision Tools operator secrets CSV"
) -ExpectedRights @{
    $script:SystemSid = $full
    $script:AdministratorsSid = $full
    $operatorSid = [int64][Security.AccessControl.FileSystemRights]::Modify
}
Assert-ExactProtectedFileAcl -Path $environment -Label (
    "Precision Tools production environment"
) -ExpectedRights @{
    $script:SystemSid = $full
    $script:AdministratorsSid = $full
    $script:LocalServiceSid = [int64][Security.AccessControl.FileSystemRights]::Read
}

Write-Host "Precision Tools protected backup task plan"
Write-Host "  Daily: 02:30"
Write-Host "  Weekly: Sunday 03:00"
Write-Host "  Principal: SYSTEM"
Write-Host "  Runtime: protected, hash-verified ProgramData bundle"
Write-Host (
    "  Output: C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\backup-output\order_portal"
)
Write-Host "  Secret source: protected external CSV"
if ($Confirmation -cne "INSTALL_PRECISION_TOOLS_BACKUP_TASKS") {
    Write-Host "Plan only. Re-run with -Confirmation INSTALL_PRECISION_TOOLS_BACKUP_TASKS"
    exit 0
}

$runtimeParent = Split-Path -Parent $runtime
Assert-TrustedRuntimeParent -Path $runtimeParent
$sourceVenv = Split-Path -Parent (Split-Path -Parent $backendPythonPath)
[void](Get-TreeItemsWithoutReparse -Root $sourceVenv `
    -Label "Source Python virtual environment")

$pythonInformation = & $backendPythonPath -I -S -c (
    "import json,sys;" +
    "print(json.dumps({'base_prefix':sys.base_prefix,'version':" +
    "'.'.join(map(str,sys.version_info[:3]))}))"
)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($pythonInformation)) {
    throw "Unable to inspect the reviewed project Python runtime"
}
$pythonMetadata = $pythonInformation | ConvertFrom-Json
$sourcePythonBase = [IO.Path]::GetFullPath([string]$pythonMetadata.base_prefix)
$sourceBasePython = Join-Path $sourcePythonBase "python.exe"
if (-not (Test-Path -LiteralPath $sourceBasePython -PathType Leaf)) {
    throw "Python base runtime was not found: $sourceBasePython"
}
[void](Get-TreeItemsWithoutReparse -Root $sourcePythonBase `
    -Label "Source Python base runtime")
$sourceRuntimeFiles = @(
    [pscustomobject]@{
        Source = $sourceWrapper
        Relative = "Invoke-PrecisionToolsProtectedBackup.ps1"
    },
    [pscustomobject]@{
        Source = $sourceBackup
        Relative = "Backup-OrderPortal.ps1"
    },
    [pscustomobject]@{
        Source = $sourceRestore
        Relative = "Restore-OrderPortal.ps1"
    },
    [pscustomobject]@{
        Source = $sourceArchiveHelper
        Relative = "backend\scripts\protected_backup_archive.py"
    }
)
foreach ($sourceFile in $sourceRuntimeFiles) {
    $sourceFile | Add-Member -NotePropertyName Sha256 -NotePropertyValue (
        Get-FileHash -LiteralPath $sourceFile.Source -Algorithm SHA256
    ).Hash.ToLowerInvariant()
}

$staging = Join-Path $runtimeParent (
    ".backup-runtime-staging-{0}" -f [Guid]::NewGuid().ToString("N")
)
$rollback = Join-Path $runtimeParent (
    ".backup-runtime-rollback-{0}" -f [Guid]::NewGuid().ToString("N")
)
$runtimeMovedToRollback = $false
$stagingCommitted = $false
try {
    [void](New-Item -ItemType Directory -Path $staging)
    Set-ProtectedRuntimeRootAcl -Path $staging

    Copy-Item -LiteralPath $sourceWrapper `
        -Destination (Join-Path $staging "Invoke-PrecisionToolsProtectedBackup.ps1")
    Copy-Item -LiteralPath $sourceBackup `
        -Destination (Join-Path $staging "Backup-OrderPortal.ps1")
    Copy-Item -LiteralPath $sourceRestore `
        -Destination (Join-Path $staging "Restore-OrderPortal.ps1")
    $helperParent = Join-Path $staging "backend\scripts"
    [void](New-Item -ItemType Directory -Path $helperParent -Force)
    Copy-Item -LiteralPath $sourceArchiveHelper `
        -Destination (Join-Path $helperParent "protected_backup_archive.py")
    Copy-Item -LiteralPath $sourceVenv `
        -Destination (Join-Path $staging ".venv") -Recurse
    Copy-Item -LiteralPath $sourcePythonBase `
        -Destination (Join-Path $staging "python-base") -Recurse
    [void](Get-TreeItemsWithoutReparse -Root $sourceVenv `
        -Label "Source Python virtual environment")
    [void](Get-TreeItemsWithoutReparse -Root $sourcePythonBase `
        -Label "Source Python base runtime")
    foreach ($path in @(
        $sourceWrapper,
        $sourceBackup,
        $sourceRestore,
        $sourceArchiveHelper
    )) {
        Assert-NoReparseComponents -Path $path `
            -Label "Backup runtime source"
    }
    foreach ($sourceFile in $sourceRuntimeFiles) {
        $currentHash = (
            Get-FileHash -LiteralPath $sourceFile.Source -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $copiedHash = (
            Get-FileHash -LiteralPath (
                Join-Path $staging $sourceFile.Relative
            ) -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if (
            $currentHash -cne [string]$sourceFile.Sha256 -or
            $copiedHash -cne [string]$sourceFile.Sha256
        ) {
            throw "Backup runtime source changed while the protected bundle was copied"
        }
    }
    [void](Get-TreeItemsWithoutReparse -Root $staging `
        -Label "Protected backup runtime staging")

    $stagingPythonBase = Join-Path $staging "python-base"
    $stagingVenv = Join-Path $staging ".venv"
    $stagingPython = Join-Path $stagingVenv "Scripts\python.exe"
    @(
        "home = $stagingPythonBase",
        "include-system-site-packages = false",
        "version = $([string]$pythonMetadata.version)",
        "executable = $(Join-Path $stagingPythonBase 'python.exe')",
        "command = $(Join-Path $stagingPythonBase 'python.exe') -m venv $stagingVenv"
    ) | Set-Content -LiteralPath (Join-Path $stagingVenv "pyvenv.cfg") `
        -Encoding ASCII
    & $stagingPython -I -c (
        "import py7zr;" +
        "assert tuple(map(int,py7zr.__version__.split('.')[:2])) >= (1,1)"
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Protected runtime Python/py7zr smoke test failed"
    }

    $finalPythonBase = Join-Path $runtime "python-base"
    $finalVenv = Join-Path $runtime ".venv"
    @(
        "home = $finalPythonBase",
        "include-system-site-packages = false",
        "version = $([string]$pythonMetadata.version)",
        "executable = $(Join-Path $finalPythonBase 'python.exe')",
        "command = $(Join-Path $finalPythonBase 'python.exe') -m venv $finalVenv"
    ) | Set-Content -LiteralPath (Join-Path $stagingVenv "pyvenv.cfg") `
        -Encoding ASCII

    Write-RuntimeManifest -Root $staging
    Assert-ProtectedRuntimeTreeAcl -Root $staging

    if (Test-Path -LiteralPath $runtime) {
        Assert-ProtectedRuntimeTreeAcl -Root $runtime
        Move-Item -LiteralPath $runtime -Destination $rollback -ErrorAction Stop
        $runtimeMovedToRollback = $true
    }
    Move-Item -LiteralPath $staging -Destination $runtime -ErrorAction Stop
    $stagingCommitted = $true

    $installedWrapper = Join-Path $runtime (
        "Invoke-PrecisionToolsProtectedBackup.ps1"
    )
    & $powerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $installedWrapper -Mode Daily -ProjectRoot $root `
        -RuntimeBundleRoot $runtime -EnvironmentFile $environment `
        -SecretsCsvPath $secretsCsv -OperatorSid $operatorSid
    if ($LASTEXITCODE -ne 0) {
        throw "Protected backup runtime smoke test failed"
    }
}
catch {
    $originalError = $_
    if ($stagingCommitted) {
        Remove-ProtectedRuntimeTree -Path $runtime `
            -RuntimeParent $runtimeParent
        $stagingCommitted = $false
    }
    if ($runtimeMovedToRollback -and (Test-Path -LiteralPath $rollback)) {
        Move-Item -LiteralPath $rollback -Destination $runtime `
            -ErrorAction Stop
        $runtimeMovedToRollback = $false
    }
    throw $originalError
}
finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-ProtectedRuntimeTree -Path $staging `
            -RuntimeParent $runtimeParent
    }
}

$installedWrapper = Join-Path $runtime "Invoke-PrecisionToolsProtectedBackup.ps1"
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
    -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable `
    -MultipleInstances IgnoreNew -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$taskPlans = @(
    [pscustomobject]@{
        Name = "Daiyujin Precision Tools Daily Backup"
        Mode = "Daily"
        Trigger = New-ScheduledTaskTrigger -Daily -At 2:30AM
    },
    [pscustomobject]@{
        Name = "Daiyujin Precision Tools Weekly Backup"
        Mode = "Weekly"
        Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3:00AM
    }
)
foreach ($plan in $taskPlans) {
    $arguments = @(
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-Argument $installedWrapper),
        "-Mode", $plan.Mode,
        "-ProjectRoot", (Quote-Argument $root),
        "-RuntimeBundleRoot", (Quote-Argument $runtime),
        "-EnvironmentFile", (Quote-Argument $environment),
        "-SecretsCsvPath", (Quote-Argument $secretsCsv),
        "-OperatorSid", (Quote-Argument $operatorSid)
    ) -join " "
    $expectedTriggerClass = if ($plan.Mode -eq "Daily") {
        "MSFT_TaskDailyTrigger"
    }
    else {
        "MSFT_TaskWeeklyTrigger"
    }
    $existing = Get-ScheduledTask -TaskName $plan.Name -TaskPath "\" `
        -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        $existingActions = @($existing.Actions)
        $existingTriggers = @($existing.Triggers)
        $knownTask = (
            (Resolve-PrincipalSid ([string]$existing.Principal.UserId)) -eq
                $script:SystemSid -and
            $existingActions.Count -eq 1 -and
            [string]$existingActions[0].Execute -eq $powerShell -and
            [string]$existingActions[0].WorkingDirectory -eq $runtime -and
            [string]$existingActions[0].Arguments -eq $arguments -and
            $existingTriggers.Count -eq 1 -and
            [string]$existingTriggers[0].CimClass.CimClassName -eq
                $expectedTriggerClass
        )
        if (-not $knownTask) {
            throw "An unowned scheduled task uses the backup task name: $($plan.Name)"
        }
        if ([string]$existing.State -eq "Running") {
            throw "The approved backup task is running; retry after it finishes: $($plan.Name)"
        }
    }
    $action = New-ScheduledTaskAction -Execute $powerShell `
        -Argument $arguments -WorkingDirectory $runtime
    Register-ScheduledTask -TaskName $plan.Name -Action $action `
        -Trigger $plan.Trigger -Principal $principal -Settings $settings `
        -Description (
            "Creates an encrypted Precision Tools backup from a protected, " +
            "hash-verified runtime without an interactive login."
        ) -Force | Out-Null
    Enable-ScheduledTask -TaskName $plan.Name | Out-Null
    $installed = Get-ScheduledTask -TaskName $plan.Name -ErrorAction Stop
    $installedActions = @($installed.Actions)
    $installedTriggers = @($installed.Triggers)
    if (
        (Resolve-PrincipalSid ([string]$installed.Principal.UserId)) -ne
            $script:SystemSid -or
        $installedActions.Count -ne 1 -or
        [string]$installedActions[0].Execute -ne $powerShell -or
        [string]$installedActions[0].WorkingDirectory -ne $runtime -or
        [string]$installedActions[0].Arguments -ne $arguments -or
        $installedTriggers.Count -ne 1 -or
        [string]$installedTriggers[0].CimClass.CimClassName -ne
            $expectedTriggerClass
    ) {
        throw "Protected backup task verification failed: $($plan.Name)"
    }
}

if ($runtimeMovedToRollback -and (Test-Path -LiteralPath $rollback)) {
    Remove-ProtectedRuntimeTree -Path $rollback `
        -RuntimeParent $runtimeParent
    $runtimeMovedToRollback = $false
}

$latestBackup = Get-ChildItem -LiteralPath (
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\backup-output\order_portal\daily"
) -Filter "order-portal-daily-*.7z" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if ($null -eq $latestBackup) {
    throw "Protected backup smoke test did not create a daily archive"
}
Write-Host "Precision Tools protected backup tasks: READY"
Write-Host "Protected runtime: $runtime"
Write-Host "Protected restore: $(Join-Path $runtime 'Restore-OrderPortal.ps1')"
Write-Host "Latest smoke-test backup: $($latestBackup.FullName)"
