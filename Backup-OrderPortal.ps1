<#
Creates encrypted, Syncthing-friendly Order Portal backup packages.

Recommended synced folder:
  C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-output\order_portal

Examples:
  $env:ORDER_PORTAL_BACKUP_PASSWORD = "your-strong-password"
  .\Invoke-PrecisionToolsProtectedBackup.ps1 -Mode Daily -OperatorSid S-1-5-21-...
  .\Install-PrecisionToolsBackupTasks.ps1  # installs protected SYSTEM tasks
#>

[CmdletBinding()]
param(
    [ValidateSet("Daily", "Weekly", "Monthly")]
    [string]$Mode = "Daily",

    [string]$ProjectRoot = "",
    [string]$BackupRoot = "",
    [string]$PythonExe = "",
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
    [string]$ProtectedWorkRoot = (
        "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
        "precision-tools\backup-work"
    ),
    [Parameter(Mandatory = $true)]
    [string]$OperatorSid,

    [switch]$CleanLegacyBackups,
    [switch]$DryRun,
    [switch]$InstallTask,
    [switch]$InstallWeeklyTask,
    [switch]$InstallMonthlyTask,

    [int]$DailyKeep = 14,
    [int]$WeeklyKeep = 8,
    [int]$MonthlyKeep = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Resolve-DefaultProjectRoot {
    $expected = [IO.Path]::GetFullPath("C:\daiyujin\daiyujinweb")
    if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
        $ProjectRoot = $expected
    }
    $requested = [IO.Path]::GetFullPath($ProjectRoot)
    if (-not $requested.Equals(
        $expected,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "ProjectRoot must use the fixed reviewed production checkout"
    }
    if (-not (Test-Path -LiteralPath $requested -PathType Container)) {
        throw "Fixed reviewed production checkout was not found"
    }
    return $requested
}

$ProjectRoot = Resolve-DefaultProjectRoot
if (-not $BackupRoot) {
    $BackupRoot = (
        "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
        "precision-tools\backup-output\order_portal"
    )
}
$BackupRoot = [IO.Path]::GetFullPath($BackupRoot)
$ExpectedBackupRoot = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\backup-output\order_portal"
)
if (-not $BackupRoot.Equals(
    $ExpectedBackupRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "BackupRoot must use the fixed protected ProgramData output path"
}

$BackendRoot = Join-Path $ProjectRoot "backend"
$EnvironmentFile = [IO.Path]::GetFullPath($EnvironmentFile)
$ProtectedArchiveScript = Join-Path (
    Join-Path $PSScriptRoot "backend\scripts"
) "protected_backup_archive.py"
$DataRoot = Join-Path $BackendRoot "data"
$DbPath = Join-Path $DataRoot "daiyujin.db"
$QuoteJobsDbPath = Join-Path $DataRoot "quote_jobs.db"
$QuoteJobStorageRoot = Join-Path $BackendRoot "uploads\quote-jobs"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ModeLower = $Mode.ToLowerInvariant()
$ProtectedWorkRoot = [IO.Path]::GetFullPath($ProtectedWorkRoot)
$ExpectedProtectedWorkRoot = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\backup-work"
)
$ExpectedRuntimeBundleRoot = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\backup-runtime"
)
if (-not [IO.Path]::GetFullPath($PSScriptRoot).Equals(
    $ExpectedRuntimeBundleRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Backup-OrderPortal.ps1 may run only from the protected runtime bundle"
}
if (-not $ProtectedWorkRoot.Equals(
    $ExpectedProtectedWorkRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "ProtectedWorkRoot must use the fixed Precision Tools backup-work path"
}
$RunRoot = Join-Path $ProtectedWorkRoot (
    "order-portal-backup-{0}-{1}" -f
        $Stamp,
        [Guid]::NewGuid().ToString("N")
)
$PayloadRoot = Join-Path $RunRoot "payload"
$LogDir = Join-Path $BackupRoot "logs"
$LogPath = Join-Path $LogDir "backup-$Stamp.log"
$script:ShadowCopyId = $null
$script:SnapshotProjectRoot = $null
$script:SnapshotDosDeviceName = $null
$script:SnapshotDosDeviceTarget = $null

function Assert-NoReparseComponents {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Label = "Precision Tools backup path"
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

function Assert-NoReparseTree {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Label = "Precision Tools backup source"
    )
    Assert-NoReparseComponents -Path $Path -Label $Label
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label was not found: $Path"
    }
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue([IO.Path]::GetFullPath($Path))
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "$Label contains a reparse point: $current"
        }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
                $queue.Enqueue($child.FullName)
            }
        }
    }
}

function Get-OwnerSid([object]$Acl) {
    return $Acl.GetOwner(
        [Security.Principal.SecurityIdentifier]
    ).Value
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Get-MutationRightsMask {
    return [int64](
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
}

function Assert-TrustedBackupOutputParent([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Protected backup output parent was not found: $Path"
    }
    Assert-NoReparseComponents -Path $Path `
        -Label "Protected backup output parent"
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (
        -not $acl.AreAccessRulesProtected -or
        (Get-OwnerSid -Acl $acl) -ne "S-1-5-32-544"
    ) {
        throw "Protected backup output parent ACL/owner contract is invalid"
    }
    $mutationRights = Get-MutationRightsMask
    $privilegedRights = @{}
    foreach ($rule in $acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )) {
        if (
            $rule.IsInherited -or
            $rule.AccessControlType -ne
                [Security.AccessControl.AccessControlType]::Allow
        ) {
            throw "Protected backup output parent contains an unexpected ACL rule"
        }
        if (
            [string]$rule.IdentityReference.Value -notin @(
                "S-1-5-18",
                "S-1-5-32-544"
            ) -and
            (([int64]$rule.FileSystemRights -band $mutationRights) -ne 0)
        ) {
            throw "Protected backup output parent grants untrusted mutation rights"
        }
        $sid = [string]$rule.IdentityReference.Value
        if ($sid -in @("S-1-5-18", "S-1-5-32-544")) {
            $current = if ($privilegedRights.ContainsKey($sid)) {
                [int64]$privilegedRights[$sid]
            }
            else {
                [int64]0
            }
            $privilegedRights[$sid] = (
                $current -bor [int64]$rule.FileSystemRights
            )
        }
    }
    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in @("S-1-5-18", "S-1-5-32-544")) {
        if (
            -not $privilegedRights.ContainsKey($sid) -or
            [int64]$privilegedRights[$sid] -ne $full
        ) {
            throw "Protected backup output parent lacks privileged FullControl"
        }
    }
}

function Assert-ProtectedBackupOutputItemAcl([string]$Path) {
    Assert-NoReparseComponents -Path $Path `
        -Label "Protected backup output item"
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (
        -not $acl.AreAccessRulesProtected -or
        (Get-OwnerSid -Acl $acl) -ne "S-1-5-32-544"
    ) {
        throw "Protected backup output item ACL/owner contract is invalid"
    }
    $operatorRights = if ($item.PSIsContainer) {
        [int64][Security.AccessControl.FileSystemRights]::ReadAndExecute
    }
    else {
        [int64][Security.AccessControl.FileSystemRights]::Read
    }
    $expected = @{
        "S-1-5-18" = [int64][Security.AccessControl.FileSystemRights]::FullControl
        "S-1-5-32-544" = [int64][Security.AccessControl.FileSystemRights]::FullControl
        $script:BackupOperatorSid = $operatorRights
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
            -not $expected.ContainsKey($sid)
        ) {
            throw "Protected backup output item grants unexpected access"
        }
        $current = if ($observed.ContainsKey($sid)) {
            [int64]$observed[$sid]
        }
        else {
            [int64]0
        }
        $observed[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    foreach ($sid in $expected.Keys) {
        if (
            -not $observed.ContainsKey($sid) -or
            [int64]$observed[$sid] -ne [int64]$expected[$sid]
        ) {
            throw "Protected backup output item rights contract is invalid"
        }
    }
}

function Set-ProtectedBackupOutputItemAcl([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer) {
        $acl = [Security.AccessControl.DirectorySecurity]::new()
    }
    else {
        $acl = [Security.AccessControl.FileSecurity]::new()
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner(
        [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
    )
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $inheritance = if ($item.PSIsContainer) {
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    else {
        [Security.AccessControl.InheritanceFlags]::None
    }
    foreach ($sidValue in @("S-1-5-18", "S-1-5-32-544")) {
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new($sidValue),
                [Security.AccessControl.FileSystemRights]::FullControl,
                $inheritance,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        )
    }
    $operatorRights = if ($item.PSIsContainer) {
        [Security.AccessControl.FileSystemRights]::ReadAndExecute
    }
    else {
        [Security.AccessControl.FileSystemRights]::Read
    }
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new(
                $script:BackupOperatorSid
            ),
            $operatorRights,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            $allow
        )
    )
    Set-Acl -LiteralPath $Path -AclObject $acl
    Assert-ProtectedBackupOutputItemAcl -Path $Path
}

function Initialize-ProtectedBackupOutput {
    try {
        $operator = [Security.Principal.SecurityIdentifier]::new($OperatorSid)
    }
    catch {
        throw "OperatorSid must be a valid Windows SID"
    }
    if ($operator.Value -in @(
        "S-1-5-18",
        "S-1-5-19",
        "S-1-5-32-544"
    )) {
        throw "OperatorSid must identify the interactive backup operator"
    }
    $script:BackupOperatorSid = $operator.Value

    $outputParent = Split-Path -Parent $ExpectedBackupRoot
    $precisionToolsParent = Split-Path -Parent $outputParent
    Assert-TrustedBackupOutputParent -Path $precisionToolsParent
    foreach ($path in @($outputParent, $ExpectedBackupRoot)) {
        Assert-NoReparseComponents -Path $path `
            -Label "Protected backup output"
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            [void](New-Item -ItemType Directory -Path $path)
        }
        Assert-NoReparseComponents -Path $path `
            -Label "Protected backup output"
        Set-ProtectedBackupOutputItemAcl -Path $path
    }
    Assert-NoReparseTree -Path $ExpectedBackupRoot `
        -Label "Protected backup output tree"
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($ExpectedBackupRoot)
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
            if (
                ([IO.FileAttributes]$child.Attributes -band
                    [IO.FileAttributes]::ReparsePoint) -ne 0
            ) {
                throw "Protected backup output contains a reparse point"
            }
            Set-ProtectedBackupOutputItemAcl -Path $child.FullName
            if ($child.PSIsContainer) {
                $queue.Enqueue($child.FullName)
            }
        }
    }
}

function Ensure-Directory([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $outputPrefix = $ExpectedBackupRoot.TrimEnd("\") + "\"
    $workPrefix = $ExpectedProtectedWorkRoot.TrimEnd("\") + "\"
    $isOutput = (
        $fullPath.Equals(
            $ExpectedBackupRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        $fullPath.StartsWith(
            $outputPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    )
    $isWork = (
        $fullPath.Equals(
            $ExpectedProtectedWorkRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        $fullPath.StartsWith(
            $workPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    )
    if (-not $isOutput -and -not $isWork) {
        throw "Refusing to create a directory outside protected backup roots"
    }
    Assert-NoReparseComponents -Path $Path -Label "Backup directory"
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
    Assert-NoReparseComponents -Path $Path -Label "Backup directory"
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Backup directory is not a directory: $Path"
    }
    if ($isOutput) {
        Set-ProtectedBackupOutputItemAcl -Path $fullPath
    }
}

function Write-Log([string]$Message, [string]$Level = "INFO") {
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    Ensure-Directory $LogDir
    Assert-NoReparseComponents -Path $LogPath -Label "Backup log"
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    Assert-NoReparseComponents -Path $LogPath -Label "Backup log"
    Set-ProtectedBackupOutputItemAcl -Path $LogPath
}

function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-PythonExe {
    $expectedPython = [IO.Path]::GetFullPath(
        (Join-Path $ExpectedRuntimeBundleRoot ".venv\Scripts\python.exe")
    )
    if (
        [string]::IsNullOrWhiteSpace($PythonExe) -or
        -not [IO.Path]::GetFullPath($PythonExe).Equals(
            $expectedPython,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "PythonExe must use the exact protected backup runtime interpreter"
    }
    if (-not (Test-Path -LiteralPath $expectedPython -PathType Leaf)) {
        throw "Protected backup runtime Python was not found"
    }
    Assert-NoReparseComponents -Path $expectedPython `
        -Label "Protected backup runtime Python"
    return $expectedPython
}

function Get-EnvironmentSetting {
    param([Parameter(Mandatory = $true)][string]$Key)
    $matches = @(
        foreach ($line in Get-Content -LiteralPath $EnvironmentFile `
            -Encoding UTF8) {
            if (
                $line -match (
                    "^\s*" + [Regex]::Escape($Key) + "\s*=\s*(.*?)\s*$"
                )
            ) {
                $Matches[1].Trim().Trim('"').Trim("'")
            }
        }
    )
    if ($matches.Count -gt 1) {
        throw "Production environment contains a duplicate $Key setting"
    }
    if ($matches.Count -eq 0) {
        return ""
    }
    return [string]$matches[0]
}

function Assert-QuoteRuntimeBackupCoverage {
    foreach ($contract in @(
        [pscustomobject]@{
            Key = "QUOTE_JOBS_DB_PATH"
            Expected = $QuoteJobsDbPath
        },
        [pscustomobject]@{
            Key = "QUOTE_JOB_STORAGE_ROOT"
            Expected = $QuoteJobStorageRoot
        }
    )) {
        $configured = Get-EnvironmentSetting -Key $contract.Key
        if ([string]::IsNullOrWhiteSpace($configured)) {
            continue
        }
        if (
            -not [IO.Path]::IsPathRooted($configured) -or
            -not [IO.Path]::GetFullPath($configured).Equals(
                [IO.Path]::GetFullPath([string]$contract.Expected),
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw (
                "$($contract.Key) must use the fixed path covered by the " +
                "protected encrypted backup"
            )
        }
    }
}

function Assert-NoReparseSnapshotTree {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Label = "Immutable volume snapshot source"
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label was not found: $Path"
    }
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($Path)
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "$Label contains a reparse point: $current"
        }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
                $queue.Enqueue($child.FullName)
            }
        }
    }
}

function Initialize-VssDosDeviceApi {
    if ($null -ne ("Daiyujin.BackupDosDevice" -as [type])) {
        return
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Daiyujin {
    public static class BackupDosDevice {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool DefineDosDevice(
            uint flags,
            string deviceName,
            string targetPath
        );

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint QueryDosDevice(
            string deviceName,
            StringBuilder targetPath,
            int maximumLength
        );
    }
}
'@
}

function Mount-ImmutableSnapshotDosDevice([string]$DeviceObject) {
    Initialize-VssDosDeviceApi
    $rawTarget = $DeviceObject -replace "^\\\\\?\\GLOBALROOT", ""
    if ($rawTarget -notmatch "^\\Device\\HarddiskVolumeShadowCopy\d+$") {
        throw "VSS returned an unexpected device object"
    }
    $selectedName = $null
    foreach ($codePoint in (90..84)) {
        $candidate = ([char]$codePoint).ToString() + ":"
        $buffer = [Text.StringBuilder]::new(32768)
        $queryResult = [Daiyujin.BackupDosDevice]::QueryDosDevice(
            $candidate,
            $buffer,
            $buffer.Capacity
        )
        if ($queryResult -eq 0) {
            $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            if ($errorCode -in @(2, 3)) {
                $selectedName = $candidate
                break
            }
        }
    }
    if ([string]::IsNullOrWhiteSpace($selectedName)) {
        throw "No unused protected VSS DOS drive name is available"
    }
    $defineFlags = [uint32](0x1 -bor 0x8)
    if (-not [Daiyujin.BackupDosDevice]::DefineDosDevice(
        $defineFlags,
        $selectedName,
        $rawTarget
    )) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Could not mount the VSS snapshot DOS device: $errorCode"
    }
    $script:SnapshotDosDeviceName = $selectedName
    $script:SnapshotDosDeviceTarget = $rawTarget
    $verifyBuffer = [Text.StringBuilder]::new(32768)
    $verifyResult = [Daiyujin.BackupDosDevice]::QueryDosDevice(
        $selectedName,
        $verifyBuffer,
        $verifyBuffer.Capacity
    )
    if (
        $verifyResult -eq 0 -or
        -not $verifyBuffer.ToString().Equals(
            $rawTarget,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "VSS snapshot DOS device verification failed"
    }
}

function New-ImmutableProjectVolumeSnapshot {
    $volumeRoot = [IO.Path]::GetPathRoot($ProjectRoot)
    if (
        [string]::IsNullOrWhiteSpace($volumeRoot) -or
        $volumeRoot.StartsWith("\\")
    ) {
        throw "Protected backup requires a local NTFS project volume"
    }
    $result = Invoke-CimMethod -ClassName Win32_ShadowCopy `
        -MethodName Create -Arguments @{
            Volume = $volumeRoot
            Context = "ClientAccessible"
        } -ErrorAction Stop
    if (
        $null -eq $result -or
        [uint32]$result.ReturnValue -ne 0 -or
        [string]::IsNullOrWhiteSpace([string]$result.ShadowID)
    ) {
        $returnValue = if ($null -eq $result) {
            "no result"
        }
        else {
            [string]$result.ReturnValue
        }
        throw "VSS project snapshot creation failed: $returnValue"
    }
    $script:ShadowCopyId = [string]$result.ShadowID
    $escapedId = $script:ShadowCopyId.Replace("'", "''")
    $shadow = Get-CimInstance -ClassName Win32_ShadowCopy `
        -Filter "ID = '$escapedId'" -ErrorAction Stop
    if (
        $null -eq $shadow -or
        [string]::IsNullOrWhiteSpace([string]$shadow.DeviceObject)
    ) {
        throw "Created VSS project snapshot could not be resolved"
    }
    Mount-ImmutableSnapshotDosDevice -DeviceObject (
        [string]$shadow.DeviceObject
    )
    $relativeProjectRoot = $ProjectRoot.Substring($volumeRoot.Length)
    $script:SnapshotProjectRoot = (
        $script:SnapshotDosDeviceName + "\" +
        $relativeProjectRoot.TrimStart("\")
    )
    if (-not (Test-Path -LiteralPath $script:SnapshotProjectRoot `
        -PathType Container)) {
        throw "VSS project snapshot root is not accessible"
    }
    Write-Log "Created immutable VSS source snapshot: $($script:ShadowCopyId)"
}

function Remove-ImmutableProjectVolumeSnapshot {
    if (
        [string]::IsNullOrWhiteSpace($script:ShadowCopyId) -and
        [string]::IsNullOrWhiteSpace($script:SnapshotDosDeviceName)
    ) {
        return
    }
    $errors = [System.Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace(
        $script:SnapshotDosDeviceName
    )) {
        try {
            Initialize-VssDosDeviceApi
            $removeFlags = [uint32](0x1 -bor 0x2 -bor 0x4 -bor 0x8)
            if (-not [Daiyujin.BackupDosDevice]::DefineDosDevice(
                $removeFlags,
                $script:SnapshotDosDeviceName,
                $script:SnapshotDosDeviceTarget
            )) {
                $errorCode = (
                    [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                )
                throw "DOS device removal returned $errorCode"
            }
            $verifyBuffer = [Text.StringBuilder]::new(32768)
            $verifyResult = [Daiyujin.BackupDosDevice]::QueryDosDevice(
                $script:SnapshotDosDeviceName,
                $verifyBuffer,
                $verifyBuffer.Capacity
            )
            if ($verifyResult -ne 0) {
                throw "DOS device remains defined"
            }
            $queryError = (
                [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            )
            if ($queryError -notin @(2, 3)) {
                throw "DOS device cleanup verification returned $queryError"
            }
            $script:SnapshotDosDeviceName = $null
            $script:SnapshotDosDeviceTarget = $null
            $script:SnapshotProjectRoot = $null
        }
        catch {
            $errors.Add("VSS DOS device cleanup: $($_.Exception.Message)")
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($script:ShadowCopyId)) {
        try {
            $escapedId = $script:ShadowCopyId.Replace("'", "''")
            $shadow = Get-CimInstance -ClassName Win32_ShadowCopy `
                -Filter "ID = '$escapedId'" -ErrorAction Stop
            if ($null -ne $shadow) {
                Remove-CimInstance -InputObject $shadow -ErrorAction Stop
            }
            $remaining = $null
            for ($attempt = 0; $attempt -lt 20; $attempt++) {
                $remaining = Get-CimInstance -ClassName Win32_ShadowCopy `
                    -Filter "ID = '$escapedId'" -ErrorAction Stop
                if ($null -eq $remaining) {
                    break
                }
                Start-Sleep -Milliseconds 250
            }
            if ($null -ne $remaining) {
                throw "snapshot remains registered"
            }
            $script:ShadowCopyId = $null
        }
        catch {
            $errors.Add("VSS snapshot cleanup: $($_.Exception.Message)")
        }
    }
    if ($errors.Count -gt 0) {
        throw ($errors -join "; ")
    }
}

function ConvertTo-ProjectSnapshotPath([string]$LivePath) {
    if ([string]::IsNullOrWhiteSpace($script:SnapshotProjectRoot)) {
        throw "Immutable project snapshot was not initialized"
    }
    $liveFullPath = [IO.Path]::GetFullPath($LivePath)
    $projectPrefix = $ProjectRoot.TrimEnd("\") + "\"
    if (
        -not $liveFullPath.Equals(
            $ProjectRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        -not $liveFullPath.StartsWith(
            $projectPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Backup source escapes the fixed project snapshot"
    }
    $relative = if ($liveFullPath.Equals(
        $ProjectRoot,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        ""
    }
    else {
        $liveFullPath.Substring($projectPrefix.Length)
    }
    if ([string]::IsNullOrWhiteSpace($relative)) {
        return $script:SnapshotProjectRoot
    }
    return $script:SnapshotProjectRoot.TrimEnd("\") + "\" + $relative
}

function Set-ProtectedWorkDirectoryAcl([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $workPrefix = $ExpectedProtectedWorkRoot.TrimEnd("\") + "\"
    if (
        -not $fullPath.Equals(
            $ExpectedProtectedWorkRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        -not $fullPath.StartsWith(
            $workPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Plaintext backup work directories must remain inside the fixed backup-work root"
    }
    Assert-NoReparseComponents -Path $fullPath `
        -Label "Protected backup work path"
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        $parent = Split-Path -Parent $fullPath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            throw "Protected backup work parent must already exist: $parent"
        }
        Assert-NoReparseComponents -Path $parent `
            -Label "Protected backup work parent"
        New-Item -ItemType Directory -Path $fullPath | Out-Null
    }
    Assert-NoReparseComponents -Path $fullPath `
        -Label "Protected backup work path"

    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $full = [Security.AccessControl.FileSystemRights]::FullControl
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $administrators = [Security.Principal.SecurityIdentifier]::new(
        "S-1-5-32-544"
    )
    $acl.SetOwner($administrators)
    foreach ($sidValue in @(
        "S-1-5-18",
        "S-1-5-32-544"
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
    Set-Acl -LiteralPath $fullPath -AclObject $acl

    $verified = Get-Acl -LiteralPath $fullPath
    if (-not $verified.AreAccessRulesProtected) {
        throw "Protected backup work ACL inheritance must be disabled"
    }
    $ownerSid = $verified.GetOwner(
        [Security.Principal.SecurityIdentifier]
    ).Value
    if ($ownerSid -ne "S-1-5-32-544") {
        throw "Protected backup work directory owner must be BUILTIN\Administrators"
    }
    $allowedSids = @(
        "S-1-5-18",
        "S-1-5-32-544"
    ) | Select-Object -Unique
    $observed = @{}
    foreach ($rule in $verified.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )) {
        $sid = [string]$rule.IdentityReference.Value
        if (
            $rule.IsInherited -or
            $rule.AccessControlType -ne
                [Security.AccessControl.AccessControlType]::Allow -or
            $sid -notin $allowedSids
        ) {
            throw "Protected backup work directory grants unexpected access"
        }
        $current = if ($observed.ContainsKey($sid)) {
            [int64]$observed[$sid]
        }
        else {
            [int64]0
        }
        $observed[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    $expectedFull = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in $allowedSids) {
        if (
            -not $observed.ContainsKey($sid) -or
            [int64]$observed[$sid] -ne $expectedFull
        ) {
            throw "Protected backup work directory is missing exact FullControl"
        }
    }
}

function Remove-ProtectedBackupWorkTree([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $runPrefix = $ExpectedProtectedWorkRoot.TrimEnd("\") +
        "\order-portal-backup-"
    if (-not $fullPath.StartsWith(
        $runPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to clean a path outside the exact backup run-root contract"
    }
    Assert-NoReparseTree -Path $fullPath `
        -Label "Protected backup cleanup target"
    Remove-Item -LiteralPath $fullPath -Recurse -Force `
        -ErrorAction Stop
    if (Test-Path -LiteralPath $fullPath) {
        throw "Protected backup cleanup failed: $fullPath"
    }
}

function Format-ArgumentsForLog([string[]]$Arguments) {
    $redactNext = $false
    return @($Arguments | ForEach-Object {
        $argument = [string]$_
        if ($redactNext) {
            $redactNext = $false
            return "********"
        }
        if ($argument -match "(?i)^--?(password|secret|token)$") {
            $redactNext = $true
            return $argument
        }
        if ($argument -match "(?i)^(-p|.*(?:password|secret|token)=)") {
            return ($argument -replace "(?i)(=|-p).*$", '$1********')
        }
        return $argument
    })
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments, [string]$Name) {
    $safeArgs = Format-ArgumentsForLog $Arguments
    Write-Log "Command: $FilePath $($safeArgs -join ' ')" "DEBUG"
    & $FilePath @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "$Name failed with exit code $code"
    }
}

function Invoke-SqliteBackup {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDb,
        [Parameter(Mandatory = $true)][string]$OutputDb,
        [Parameter(Mandatory = $true)][string]$MetaPath,
        [ValidateSet("portal", "quote_jobs")]
        [string]$DatabaseKind = "portal"
    )
    if (-not (Test-Path -LiteralPath $SourceDb)) {
        throw "SQLite database not found: $SourceDb"
    }
    $runPrefix = $RunRoot.TrimEnd("\") + "\"
    if (-not [IO.Path]::GetFullPath($SourceDb).StartsWith(
        $runPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "SQLite backup source must be the protected VSS snapshot copy"
    }
    Assert-NoReparseTree -Path $SourceDb `
        -Label "Production SQLite backup source"
    Ensure-Directory (Split-Path -Parent $OutputDb)
    Ensure-Directory (Split-Path -Parent $MetaPath)

    $py = Resolve-PythonExe
    $scriptPath = Join-Path $RunRoot "sqlite_backup.py"
    $code = @'
import argparse
import json
import os
import sqlite3
from datetime import datetime

TABLES = {
    "portal": [
        "portal_users",
        "portal_orders",
        "portal_order_updates",
        "portal_order_media",
        "portal_messages",
        "portal_events",
        "portal_audit_logs",
        "portal_security_logs",
    ],
    "quote_jobs": [
        "quote_analysis_jobs",
        "quote_analysis_parts",
        "quote_worker_heartbeats",
    ],
}
REQUIRED = {
    "portal": [
        "portal_users",
        "portal_orders",
        "portal_order_updates",
        "portal_order_media",
        "portal_messages",
        "portal_events",
    ],
    "quote_jobs": TABLES["quote_jobs"],
}

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--meta", required=True)
parser.add_argument("--kind", required=True, choices=sorted(TABLES))
args = parser.parse_args()
tables = TABLES[args.kind]
required_tables = REQUIRED[args.kind]

src = sqlite3.connect(args.source)
dst = sqlite3.connect(args.output)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()

con = sqlite3.connect(args.output)
try:
    existing = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    counts = {}
    for table in tables:
        if table in existing:
            counts[table] = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        else:
            counts[table] = None
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    missing = [table for table in required_tables if table not in existing]
finally:
    con.close()

meta = {
    "created_at": datetime.now().astimezone().isoformat(),
    "database_kind": args.kind,
    "source_db": args.source,
    "output_db": args.output,
    "db_size_bytes": os.path.getsize(args.output),
    "sqlite_integrity_check": integrity,
    "missing_tables": missing,
    "table_counts": counts,
}
with open(args.meta, "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
if integrity != "ok":
    raise SystemExit(f"SQLite integrity_check failed: {integrity}")
if missing:
    raise SystemExit("Missing required SQLite tables: " + ", ".join(missing))
'@
    Set-Content -LiteralPath $scriptPath -Value $code -Encoding UTF8
    Invoke-Native -FilePath $py -Arguments @(
        "-B", $scriptPath,
        "--source", $SourceDb,
        "--output", $OutputDb,
        "--meta", $MetaPath,
        "--kind", $DatabaseKind
    ) -Name "SQLite backup"
    Assert-NoReparseTree -Path $SourceDb `
        -Label "Production SQLite backup source"
    Assert-NoReparseTree -Path $OutputDb `
        -Label "Protected SQLite backup output"
    Assert-NoReparseTree -Path $MetaPath `
        -Label "Protected SQLite metadata output"
}

function Copy-IfExists([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) {
        Write-Log "Optional item not found, skipping: $Source" "WARN"
        return
    }
    $snapshotPrefix = $script:SnapshotProjectRoot.TrimEnd("\") + "\"
    $sourceIsSnapshot = (
        $Source.Equals(
            $script:SnapshotProjectRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        $Source.StartsWith(
            $snapshotPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    )
    $runPrefix = $RunRoot.TrimEnd("\") + "\"
    $sourceIsProtectedWork = $false
    if (-not $sourceIsSnapshot) {
        $sourceFullPath = [IO.Path]::GetFullPath($Source)
        $sourceIsProtectedWork = (
            $sourceFullPath.Equals(
                $RunRoot,
                [StringComparison]::OrdinalIgnoreCase
            ) -or
            $sourceFullPath.StartsWith(
                $runPrefix,
                [StringComparison]::OrdinalIgnoreCase
            )
        )
    }
    if (-not $sourceIsSnapshot -and -not $sourceIsProtectedWork) {
        throw "Backup payload copy source must come from VSS or protected work"
    }
    if ($sourceIsSnapshot) {
        Assert-NoReparseSnapshotTree -Path $Source `
            -Label "Immutable VSS backup source"
    }
    else {
        Assert-NoReparseTree -Path $Source `
            -Label "Protected backup payload source"
    }
    $destinationFullPath = [IO.Path]::GetFullPath($Destination)
    if (-not $destinationFullPath.StartsWith(
        $runPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Backup payload copy destination must remain in protected work"
    }
    Ensure-Directory (Split-Path -Parent $Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    if ($sourceIsSnapshot) {
        Assert-NoReparseSnapshotTree -Path $Source `
            -Label "Immutable VSS backup source"
    }
    else {
        Assert-NoReparseTree -Path $Source `
            -Label "Protected backup payload source"
    }
    Assert-NoReparseTree -Path $Destination `
        -Label "Protected backup payload copy"
}

function New-SnapshotSqliteSource {
    param(
        [Parameter(Mandatory = $true)][string]$LiveDbPath,
        [Parameter(Mandatory = $true)][string]$DatabaseName,
        [switch]$Required
    )
    $snapshotDb = ConvertTo-ProjectSnapshotPath -LivePath $LiveDbPath
    if (-not (Test-Path -LiteralPath $snapshotDb -PathType Leaf)) {
        if ($Required) {
            throw (
                "Immutable VSS snapshot is missing the required production " +
                "SQLite database: $DatabaseName"
            )
        }
        Write-Log (
            "Optional production SQLite database not found, skipping: " +
            $DatabaseName
        ) "WARN"
        return $null
    }
    Assert-NoReparseSnapshotTree -Path $snapshotDb `
        -Label "Immutable VSS SQLite source"
    $snapshotSourceRoot = Join-Path (
        Join-Path $RunRoot "sqlite-source"
    ) $DatabaseName
    Ensure-Directory $snapshotSourceRoot
    $protectedDb = Join-Path $snapshotSourceRoot $DatabaseName
    Copy-IfExists -Source $snapshotDb -Destination $protectedDb
    foreach ($suffix in @("-wal", "-shm", "-journal")) {
        $snapshotSidecar = "$snapshotDb$suffix"
        if (Test-Path -LiteralPath $snapshotSidecar -PathType Leaf) {
            Copy-IfExists -Source $snapshotSidecar `
                -Destination "$protectedDb$suffix"
        }
    }
    Assert-NoReparseTree -Path $snapshotSourceRoot `
        -Label "Protected VSS SQLite source copy"
    return $protectedDb
}

function Add-RuntimePayload {
    Write-Log "Creating runtime payload"
    $dbOut = Join-Path $PayloadRoot "backend\data\daiyujin.db"
    $dbMeta = Join-Path $PayloadRoot "db-meta.json"
    $snapshotDb = New-SnapshotSqliteSource `
        -LiveDbPath $DbPath -DatabaseName "daiyujin.db" -Required
    Invoke-SqliteBackup -SourceDb $snapshotDb `
        -OutputDb $dbOut -MetaPath $dbMeta

    $quoteJobsSnapshot = New-SnapshotSqliteSource `
        -LiveDbPath $QuoteJobsDbPath -DatabaseName "quote_jobs.db"
    $snapshotQuoteStorage = ConvertTo-ProjectSnapshotPath `
        -LivePath $QuoteJobStorageRoot
    $quoteStorageHasItems = $false
    if (Test-Path -LiteralPath $snapshotQuoteStorage) {
        Assert-NoReparseSnapshotTree -Path $snapshotQuoteStorage `
            -Label "Immutable VSS quote-job storage"
        if (-not (Test-Path -LiteralPath $snapshotQuoteStorage `
            -PathType Container)) {
            throw "Quote-job storage must be a directory"
        }
        $quoteStorageHasItems = @(
            Get-ChildItem -LiteralPath $snapshotQuoteStorage -Force
        ).Count -gt 0
    }
    if ($null -eq $quoteJobsSnapshot -and $quoteStorageHasItems) {
        throw (
            "Quote-job storage contains customer data but quote_jobs.db is " +
            "missing; refusing an incomplete protected backup"
        )
    }
    if ($null -ne $quoteJobsSnapshot) {
        Invoke-SqliteBackup -SourceDb $quoteJobsSnapshot `
            -OutputDb (
                Join-Path $PayloadRoot "backend\data\quote_jobs.db"
            ) `
            -MetaPath (Join-Path $PayloadRoot "quote-jobs-db-meta.json") `
            -DatabaseKind "quote_jobs"
    }

    foreach ($mapping in @(
        @("backend\private\order_media", "backend\private\order_media"),
        @("backend\private\nextgen_handoff", "backend\private\nextgen_handoff"),
        @("backend\uploads", "backend\uploads"),
        @("backend\static\thumbnails", "backend\static\thumbnails"),
        @("backend\static\stl", "backend\static\stl")
    )) {
        Copy-IfExists -Source (
            ConvertTo-ProjectSnapshotPath (
                Join-Path $ProjectRoot $mapping[0]
            )
        ) -Destination (Join-Path $PayloadRoot $mapping[1])
    }
}

function Get-DirectoryFileCount([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    return @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force).Count
}

function New-Manifest([string]$PackageName, [hashtable]$PackageHashes) {
    $dbMetaPath = Join-Path $PayloadRoot "db-meta.json"
    $dbMeta = $null
    if (Test-Path -LiteralPath $dbMetaPath) {
        $dbMeta = Get-Content -LiteralPath $dbMetaPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    $quoteJobsMetaPath = Join-Path $PayloadRoot "quote-jobs-db-meta.json"
    $quoteJobsMeta = $null
    if (Test-Path -LiteralPath $quoteJobsMetaPath) {
        $quoteJobsMeta = Get-Content -LiteralPath $quoteJobsMetaPath `
            -Raw -Encoding UTF8 | ConvertFrom-Json
    }

    $counts = @{}
    if ($dbMeta -and $dbMeta.table_counts) {
        foreach ($prop in $dbMeta.table_counts.PSObject.Properties) {
            $counts[$prop.Name] = $prop.Value
        }
    }

    $manifest = [ordered]@{
        contract = "daiyujin-public-pilot-precision-tools-backup-v1"
        created_at = (Get-Date).ToString("o")
        mode = $ModeLower
        project_root = $ProjectRoot
        backup_root = $BackupRoot
        db_path = "backend/data/daiyujin.db"
        db_size_bytes = if ($dbMeta) { [int64]$dbMeta.db_size_bytes } else { 0 }
        sqlite_integrity_check = if ($dbMeta) { $dbMeta.sqlite_integrity_check } else { $null }
        quote_jobs_db_path = "backend/data/quote_jobs.db"
        quote_jobs_db_included = [bool]($null -ne $quoteJobsMeta)
        quote_jobs_db_size_bytes = if ($quoteJobsMeta) {
            [int64]$quoteJobsMeta.db_size_bytes
        }
        else {
            0
        }
        quote_jobs_sqlite_integrity_check = if ($quoteJobsMeta) {
            $quoteJobsMeta.sqlite_integrity_check
        }
        else {
            $null
        }
        quote_job_storage_file_count = Get-DirectoryFileCount (
            Join-Path $PayloadRoot "backend\uploads\quote-jobs"
        )
        portal_user_count = if ($counts.ContainsKey("portal_users")) { $counts["portal_users"] } else { $null }
        portal_order_count = if ($counts.ContainsKey("portal_orders")) { $counts["portal_orders"] } else { $null }
        portal_message_count = if ($counts.ContainsKey("portal_messages")) { $counts["portal_messages"] } else { $null }
        portal_media_count = if ($counts.ContainsKey("portal_order_media")) { $counts["portal_order_media"] } else { $null }
        local_media_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\private\order_media")
        nextgen_handoff_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\private\nextgen_handoff")
        uploads_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\uploads")
        thumbnail_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\static\thumbnails")
        stl_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\static\stl")
        r2_media_count = $null
        package = $PackageName
        sha256 = $PackageHashes
    }
    return $manifest
}

function Write-JsonFile($Object, [string]$Path) {
    Ensure-Directory (Split-Path -Parent $Path)
    Assert-NoReparseComponents -Path $Path -Label "JSON output"
    if (Test-Path -LiteralPath $Path) {
        throw "Refusing to overwrite an existing JSON output: $Path"
    }
    $temporaryPath = Join-Path (Split-Path -Parent $Path) (
        ".{0}.{1}.tmp" -f (
            Split-Path -Leaf $Path
        ), [Guid]::NewGuid().ToString("N")
    )
    $stream = $null
    $writer = $null
    try {
        $stream = [IO.File]::Open(
            $temporaryPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )
        $writer = [IO.StreamWriter]::new(
            $stream,
            [Text.UTF8Encoding]::new($false)
        )
        $writer.Write(($Object | ConvertTo-Json -Depth 10))
        $writer.Flush()
        $stream.Flush($true)
        $writer.Dispose()
        $writer = $null
        $stream = $null
        Assert-NoReparseTree -Path $temporaryPath `
            -Label "JSON output staging file"
        [IO.File]::Move($temporaryPath, $Path)
        Assert-NoReparseTree -Path $Path -Label "JSON output"
        $outputPrefix = $ExpectedBackupRoot.TrimEnd("\") + "\"
        if ([IO.Path]::GetFullPath($Path).StartsWith(
            $outputPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )) {
            Set-ProtectedBackupOutputItemAcl -Path $Path
        }
    }
    finally {
        if ($null -ne $writer) {
            $writer.Dispose()
        }
        elseif ($null -ne $stream) {
            $stream.Dispose()
        }
        if (Test-Path -LiteralPath $temporaryPath) {
            Assert-NoReparseTree -Path $temporaryPath `
                -Label "JSON output cleanup target"
            Remove-Item -LiteralPath $temporaryPath -Force `
                -ErrorAction Stop
            if (Test-Path -LiteralPath $temporaryPath) {
                throw "JSON output cleanup failed: $temporaryPath"
            }
        }
    }
}

function Compress-ProtectedArchive([string]$SourceFolder, [string]$ArchivePath) {
    if ($DryRun) {
        Write-Log "Dry-run: would create encrypted archive $ArchivePath"
        return
    }
    if (-not (Test-Path -LiteralPath $ProtectedArchiveScript -PathType Leaf)) {
        throw "Protected archive helper not found: $ProtectedArchiveScript"
    }
    Assert-NoReparseTree -Path $ProtectedArchiveScript `
        -Label "Protected archive helper"
    Assert-NoReparseTree -Path $SourceFolder `
        -Label "Protected archive source"
    $outputPrefix = $ExpectedBackupRoot.TrimEnd("\") + "\"
    if (-not [IO.Path]::GetFullPath($ArchivePath).StartsWith(
        $outputPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Protected archive destination must remain in backup-output"
    }
    Assert-NoReparseComponents -Path $ArchivePath `
        -Label "Protected archive destination"
    if (Test-Path -LiteralPath $ArchivePath) {
        throw "Refusing to overwrite an existing protected archive: $ArchivePath"
    }
    Ensure-Directory (Split-Path -Parent $ArchivePath)
    $py = Resolve-PythonExe
    Invoke-Native -FilePath $py -Arguments @(
        "-B", $ProtectedArchiveScript, "create",
        "--source", $SourceFolder,
        "--archive", $ArchivePath
    ) -Name "Protected archive creation"
    Invoke-Native -FilePath $py -Arguments @(
        "-B", $ProtectedArchiveScript, "verify",
        "--archive", $ArchivePath
    ) -Name "Protected archive verification"
    Assert-NoReparseTree -Path $SourceFolder `
        -Label "Protected archive source"
    Assert-NoReparseTree -Path $ArchivePath `
        -Label "Protected archive output"
    Set-ProtectedBackupOutputItemAcl -Path $ArchivePath
}

function Invoke-LegacyCleanup {
    if (-not $CleanLegacyBackups) { return }
    throw (
        "Privileged legacy cleanup is disabled. Review and remove legacy " +
        "checkout files interactively without the SYSTEM backup workflow."
    )
}

function Invoke-RetentionCleanup {
    $rules = @{
        daily = $DailyKeep
        weekly = $WeeklyKeep
        monthly = $MonthlyKeep
    }
    foreach ($key in $rules.Keys) {
        $keep = [int]$rules[$key]
        $dir = Join-Path $BackupRoot $key
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $archives = @(Get-ChildItem -LiteralPath $dir -Filter "order-portal-$key-*.7z" -File -Force | Sort-Object LastWriteTime -Descending)
        if ($archives.Count -le $keep) { continue }
        $toRemove = $archives | Select-Object -Skip $keep
        foreach ($archive in $toRemove) {
            $manifest = Join-Path $dir ($archive.BaseName + ".manifest.json")
            if ($DryRun) {
                Write-Log "Dry-run: would remove old backup $($archive.FullName)"
                continue
            }
            Assert-NoReparseTree -Path $archive.FullName `
                -Label "Backup retention cleanup target"
            Remove-Item -LiteralPath $archive.FullName -Force `
                -ErrorAction Stop
            if (Test-Path -LiteralPath $archive.FullName) {
                throw "Backup retention cleanup failed: $($archive.FullName)"
            }
            if (Test-Path -LiteralPath $manifest) {
                Assert-NoReparseTree -Path $manifest `
                    -Label "Backup manifest cleanup target"
                Remove-Item -LiteralPath $manifest -Force `
                    -ErrorAction Stop
                if (Test-Path -LiteralPath $manifest) {
                    throw "Backup manifest cleanup failed: $manifest"
                }
            }
            Write-Log "Removed old backup: $($archive.FullName)"
        }
    }
}

try {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($currentSid -ne "S-1-5-18" -and -not (Test-Administrator)) {
        throw "Protected backup requires SYSTEM or an elevated administrator"
    }
    if ($InstallTask -or $InstallWeeklyTask -or $InstallMonthlyTask) {
        throw (
            "Direct backup task installation is disabled. Use " +
            "Install-PrecisionToolsBackupTasks.ps1 so SYSTEM receives the " +
            "backup password only from the protected CSV at run time."
        )
    }
    $expectedEnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env"
    if (-not $EnvironmentFile.Equals(
        [IO.Path]::GetFullPath($expectedEnvironmentFile),
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Precision Tools backup requires the reviewed external environment file"
    }
    if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
        throw "Precision Tools external environment file was not found"
    }
    Assert-QuoteRuntimeBackupCoverage
    Assert-NoReparseComponents -Path $ProjectRoot `
        -Label "Fixed production checkout"

    Initialize-ProtectedBackupOutput
    Ensure-Directory $BackupRoot
    foreach ($dir in @(
        "daily",
        "weekly",
        "monthly",
        "legacy",
        "logs",
        "restore_tests",
        "pre_restore"
    )) {
        Ensure-Directory (Join-Path $BackupRoot $dir)
    }
    Set-ProtectedWorkDirectoryAcl -Path $ProtectedWorkRoot
    Set-ProtectedWorkDirectoryAcl -Path $RunRoot

    Write-Log "Starting Order Portal backup"
    Write-Log "ProjectRoot: $ProjectRoot"
    Write-Log "BackupRoot:  $BackupRoot"
    Write-Log "Mode:        $Mode"

    Invoke-LegacyCleanup

    if ($DryRun) {
        Write-Log "Dry-run: skipping backup package creation"
        Invoke-RetentionCleanup
        return
    }

    New-ImmutableProjectVolumeSnapshot
    Ensure-Directory $PayloadRoot
    Add-RuntimePayload

    $packageDir = Join-Path $BackupRoot $ModeLower
    Ensure-Directory $packageDir
    $packageName = "order-portal-$ModeLower-$Stamp.7z"
    $packagePath = Join-Path $packageDir $packageName

    $internalManifest = New-Manifest -PackageName $packageName -PackageHashes @{}
    Write-JsonFile -Object $internalManifest -Path (Join-Path $PayloadRoot "manifest.json")

    Compress-ProtectedArchive -SourceFolder $PayloadRoot -ArchivePath $packagePath
    $hashes = @{ $packageName = (Get-FileSha256 $packagePath) }
    $externalManifest = New-Manifest -PackageName $packageName -PackageHashes $hashes
    $manifestPath = Join-Path $packageDir ("order-portal-$ModeLower-$Stamp.manifest.json")
    Write-JsonFile -Object $externalManifest -Path $manifestPath

    Invoke-RetentionCleanup

    Write-Log "Backup created: $packagePath"
    Write-Log "Manifest:       $manifestPath"
    Write-Log "Syncthing folder: $BackupRoot"
}
finally {
    $cleanupErrors = [System.Collections.Generic.List[string]]::new()
    if (
        -not [string]::IsNullOrWhiteSpace($script:ShadowCopyId) -or
        -not [string]::IsNullOrWhiteSpace(
            $script:SnapshotDosDeviceName
        )
    ) {
        try {
            Remove-ImmutableProjectVolumeSnapshot
        }
        catch {
            $cleanupErrors.Add("VSS cleanup: $($_.Exception.Message)")
        }
    }
    if (Test-Path -LiteralPath $RunRoot) {
        try {
            Remove-ProtectedBackupWorkTree -Path $RunRoot
        }
        catch {
            $cleanupErrors.Add(
                "protected work cleanup: $($_.Exception.Message)"
            )
        }
    }
    if ($cleanupErrors.Count -gt 0) {
        throw "Protected backup cleanup failed: $($cleanupErrors -join '; ')"
    }
}
