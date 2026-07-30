<#
Restores an encrypted Order Portal backup as a rollback-safe transaction.

Examples:
  $root = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-output\order_portal"
  $runtime = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-runtime"
  $powershell = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
  & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$runtime\Restore-OrderPortal.ps1" -BackupZip "$root\daily\order-portal-daily-20260708-023000.7z" -DryRun
  & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$runtime\Restore-OrderPortal.ps1" -BackupZip "$root\daily\order-portal-daily-20260708-023000.7z" -IHaveStoppedApi -Confirmation RESTORE_ORDER_PORTAL_TRANSACTION
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupZip,
    [string]$ProjectRoot = "C:\daiyujin\daiyujinweb",
    [string]$BackupRoot = "",
    [string]$RuntimeBundleRoot = (
        "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
        "precision-tools\backup-runtime"
    ),
    [string]$PythonExe = "",
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [string]$ProtectedWorkRoot = (
        "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
        "precision-tools\restore-work"
    ),
    [switch]$RestoreEnv,
    [bool]$RestoreLocalMedia = $true,
    [switch]$DryRun,
    [switch]$IHaveStoppedApi,
    [switch]$StartApiAfterRestore,
    [string]$Confirmation = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$script:SystemSid = "S-1-5-18"
$script:AdministratorsSid = "S-1-5-32-544"
$script:LocalServiceSid = "S-1-5-19"
$script:ExpectedProjectRoot = [IO.Path]::GetFullPath(
    "C:\daiyujin\daiyujinweb"
)
$script:ExpectedRuntimeBundleRoot = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\backup-runtime"
)
$script:ExpectedRuntimePython = Join-Path (
    $script:ExpectedRuntimeBundleRoot
) ".venv\Scripts\python.exe"
$script:ExpectedPowerShellExe = [IO.Path]::GetFullPath(
    "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
)
$script:ExpectedEnvironmentFile = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env"
)
$script:ExpectedSecretsCsvPath = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
)
$script:ExpectedProtectedWorkRoot = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\restore-work"
)
$script:RuntimeManifestName = "bundle-manifest.json"
$script:RuntimeContract = "daiyujin-precision-tools-backup-runtime-v1"
$script:BackupContract = (
    "daiyujin-public-pilot-precision-tools-backup-v1"
)
$script:ApprovedWriterTaskNames = @(
    "Daiyujin Precision Tools API",
    "Daiyujin Quote Worker",
    "Daiyujin Exchange Rate Update",
    "Daiyujin Precision Tools Daily Backup",
    "Daiyujin Precision Tools Weekly Backup"
)

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if (-not $ProjectRoot.Equals(
    $script:ExpectedProjectRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Restore ProjectRoot must use the fixed reviewed production checkout"
}
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Fixed Precision Tools production checkout was not found"
}
$RuntimeBundleRoot = [IO.Path]::GetFullPath($RuntimeBundleRoot)
if (-not $RuntimeBundleRoot.Equals(
    $script:ExpectedRuntimeBundleRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Restore runtime must use the fixed protected ProgramData bundle"
}
$scriptDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $scriptDirectory.Equals(
    $RuntimeBundleRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Restore may run only from the fixed protected runtime bundle"
}
if (-not $BackupRoot) {
    $BackupRoot = (
        "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
        "precision-tools\backup-output\order_portal"
    )
}
$BackupRoot = [IO.Path]::GetFullPath($BackupRoot)
$expectedBackupRoot = [IO.Path]::GetFullPath(
    "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
    "precision-tools\backup-output\order_portal"
)
if (-not $BackupRoot.Equals(
    $expectedBackupRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Restore BackupRoot must use the fixed protected ProgramData output"
}
$BackendRoot = Join-Path $ProjectRoot "backend"
$EnvironmentFile = [IO.Path]::GetFullPath($EnvironmentFile)
if (-not $EnvironmentFile.Equals(
    $script:ExpectedEnvironmentFile,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Precision Tools restore requires the reviewed external environment file"
}
$SecretsCsvPath = [IO.Path]::GetFullPath($SecretsCsvPath)
if (-not $SecretsCsvPath.Equals(
    $script:ExpectedSecretsCsvPath,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Precision Tools restore requires the protected operator secrets CSV"
}
$ProtectedWorkRoot = [IO.Path]::GetFullPath($ProtectedWorkRoot)
if (-not $ProtectedWorkRoot.Equals(
    $script:ExpectedProtectedWorkRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "ProtectedWorkRoot must use the fixed Precision Tools restore-work path"
}
$BackupZip = [IO.Path]::GetFullPath($BackupZip)
$backupRootPrefix = $BackupRoot.TrimEnd("\") + "\"
if (-not $BackupZip.StartsWith(
    $backupRootPrefix,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Restore archive must remain inside the protected backup output root"
}
if ([IO.Path]::GetExtension($BackupZip) -cne ".7z") {
    throw "Restore archive must use the protected .7z format"
}
$ProtectedArchiveScript = Join-Path (
    Join-Path $RuntimeBundleRoot "backend\scripts"
) "protected_backup_archive.py"
$DbPath = Join-Path $BackendRoot "data\daiyujin.db"
$QuoteJobsDbPath = Join-Path $BackendRoot "data\quote_jobs.db"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TransactionId = [Guid]::NewGuid().ToString("N")
$RestoreRoot = Join-Path $ProtectedWorkRoot (
    "restore-{0}-{1}" -f $Stamp, $TransactionId
)
$ExtractRoot = Join-Path $RestoreRoot "extract"
$LogDir = Join-Path $BackupRoot "logs"
$LogPath = Join-Path $LogDir "restore-$Stamp.log"

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Assert-NoReparseComponents {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Label = "Precision Tools restore path"
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
        [string]$Label = "Precision Tools restore source"
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

function Get-OwnerSid {
    param([Parameter(Mandatory = $true)][object]$Acl)
    return $Acl.GetOwner(
        [Security.Principal.SecurityIdentifier]
    ).Value
}

function Get-ProtectedRuntimeItems {
    param([Parameter(Mandatory = $true)][string]$Root)
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
            throw "Protected restore runtime contains a reparse point: $current"
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
        throw "Protected restore runtime item escapes its bundle root"
    }
    return $fullPath.Substring($prefix.Length).Replace("\", "/")
}

function Assert-ProtectedRuntimeItemAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$RequireProtected
    )
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (
        $RequireProtected -and
        -not $acl.AreAccessRulesProtected
    ) {
        throw "Protected restore runtime root must disable ACL inheritance"
    }
    if ((Get-OwnerSid -Acl $acl) -ne $script:AdministratorsSid) {
        throw "Protected restore runtime item owner is not BUILTIN\Administrators"
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
            $sid -notin @(
                $script:SystemSid,
                $script:AdministratorsSid
            )
        ) {
            throw "Protected restore runtime item grants unexpected access"
        }
        $current = if ($observed.ContainsKey($sid)) {
            [int64]$observed[$sid]
        }
        else {
            [int64]0
        }
        $observed[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in @(
        $script:SystemSid,
        $script:AdministratorsSid
    )) {
        if (
            -not $observed.ContainsKey($sid) -or
            [int64]$observed[$sid] -ne $full
        ) {
            throw "Protected restore runtime item lacks exact FullControl"
        }
    }
}

function Assert-ProtectedRuntimeBundle {
    param([Parameter(Mandatory = $true)][string]$Root)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "Protected restore runtime bundle was not found: $Root"
    }
    Assert-NoReparseComponents -Path $Root `
        -Label "Protected restore runtime"
    $items = @(Get-ProtectedRuntimeItems -Root $Root)
    for ($index = 0; $index -lt $items.Count; $index++) {
        Assert-ProtectedRuntimeItemAcl -Path $items[$index].FullName `
            -RequireProtected:($index -eq 0)
    }

    $manifestPath = Join-Path $Root $script:RuntimeManifestName
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Protected restore runtime manifest was not found"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    if ([string]$manifest.contract -cne $script:RuntimeContract) {
        throw "Protected restore runtime manifest contract is invalid"
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
            throw "Protected restore runtime manifest contains an unsafe path"
        }
        if ($relative -ceq $script:RuntimeManifestName) {
            throw "Protected restore runtime manifest cannot list itself"
        }
        if ($declared.ContainsKey($relative)) {
            throw "Protected restore runtime manifest contains a duplicate path"
        }
        $declared[$relative] = [string]$entry.sha256
    }

    $actual = @{}
    foreach ($item in $items | Where-Object { -not $_.PSIsContainer }) {
        $relative = Get-RuntimeRelativePath -Root $Root `
            -Path $item.FullName
        if ($relative -ceq $script:RuntimeManifestName) {
            continue
        }
        $actual[$relative] = $item.FullName
    }
    if ($actual.Count -ne $declared.Count) {
        throw "Protected restore runtime file set differs from its manifest"
    }
    foreach ($relative in $declared.Keys) {
        if (-not $actual.ContainsKey($relative)) {
            throw "Protected restore runtime manifest references a missing file"
        }
        $expectedHash = [string]$declared[$relative]
        if ($expectedHash -notmatch "^[0-9a-f]{64}$") {
            throw "Protected restore runtime manifest contains an invalid hash"
        }
        $actualHash = (
            Get-FileHash -LiteralPath $actual[$relative] -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($actualHash -cne $expectedHash) {
            throw "Protected restore runtime hash mismatch: $relative"
        }
    }
    Assert-NoReparseComponents -Path $Root `
        -Label "Protected restore runtime"
}

function Ensure-Directory([string]$Path) {
    Assert-NoReparseComponents -Path $Path -Label "Restore directory"
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
    Assert-NoReparseComponents -Path $Path -Label "Restore directory"
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Restore directory is not a directory: $Path"
    }
}

function Write-Log([string]$Message, [string]$Level = "INFO") {
    $line = "[{0}] [{1}] {2}" -f (
        Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    ), $Level, $Message
    Write-Host $line
    Ensure-Directory $LogDir
    Assert-NoReparseComponents -Path $LogPath -Label "Restore log"
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    Assert-NoReparseComponents -Path $LogPath -Label "Restore log"
}

function Set-ProtectedWorkDirectoryAcl([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $workPrefix = $script:ExpectedProtectedWorkRoot.TrimEnd("\") + "\"
    if (
        -not $fullPath.Equals(
            $script:ExpectedProtectedWorkRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        -not $fullPath.StartsWith(
            $workPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Plaintext restore work directories must remain inside the fixed restore-work root"
    }
    Assert-NoReparseComponents -Path $fullPath `
        -Label "Protected restore work path"
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        $parent = Split-Path -Parent $fullPath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            throw "Protected restore work parent must already exist: $parent"
        }
        Assert-NoReparseComponents -Path $parent `
            -Label "Protected restore work parent"
        [void](New-Item -ItemType Directory -Path $fullPath)
    }
    Assert-NoReparseComponents -Path $fullPath `
        -Label "Protected restore work path"

    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $administrators = [Security.Principal.SecurityIdentifier]::new(
        "S-1-5-32-544"
    )
    $acl.SetOwner($administrators)
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    $allowedSids = @(
        "S-1-5-18",
        "S-1-5-32-544"
    ) | Select-Object -Unique
    foreach ($sidValue in $allowedSids) {
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
    Set-Acl -LiteralPath $fullPath -AclObject $acl
    $verified = Get-Acl -LiteralPath $fullPath
    if (
        -not $verified.AreAccessRulesProtected -or
        $verified.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value -ne "S-1-5-32-544"
    ) {
        throw "Protected restore work ACL/owner verification failed"
    }
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
            throw "Protected restore work directory grants unexpected access"
        }
        $current = if ($observed.ContainsKey($sid)) {
            [int64]$observed[$sid]
        }
        else {
            [int64]0
        }
        $observed[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in $allowedSids) {
        if (
            -not $observed.ContainsKey($sid) -or
            [int64]$observed[$sid] -ne $full
        ) {
            throw "Protected restore work directory is missing exact FullControl"
        }
    }
}

function Assert-ProtectedEnvironmentFileAcl([string]$Path) {
    Assert-NoReparseTree -Path $Path `
        -Label "Precision Tools external environment file"
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (
        -not $acl.AreAccessRulesProtected -or
        $acl.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value -ne "S-1-5-32-544"
    ) {
        throw "Precision Tools environment ACL/owner contract is invalid"
    }
    $expected = @{
        "S-1-5-18" = [int64][Security.AccessControl.FileSystemRights]::FullControl
        "S-1-5-32-544" = [int64][Security.AccessControl.FileSystemRights]::FullControl
        "S-1-5-19" = [int64][Security.AccessControl.FileSystemRights]::Read
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
            throw "Precision Tools environment grants unexpected access"
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
            throw "Precision Tools environment rights contract is invalid"
        }
    }
}

function Assert-ProtectedSecretsCsvAcl(
    [string]$Path,
    [string]$OperatorSid
) {
    if (
        $OperatorSid -in @(
            $script:SystemSid,
            $script:AdministratorsSid,
            $script:LocalServiceSid
        )
    ) {
        throw "Restore operator must be an interactive administrator identity"
    }
    Assert-NoReparseTree -Path $Path `
        -Label "Precision Tools operator secrets CSV"
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (
        -not $acl.AreAccessRulesProtected -or
        (Get-OwnerSid -Acl $acl) -ne $script:AdministratorsSid
    ) {
        throw "Precision Tools operator secrets CSV ACL/owner contract is invalid"
    }
    $expected = @{
        $script:SystemSid = [int64][Security.AccessControl.FileSystemRights]::FullControl
        $script:AdministratorsSid = [int64][Security.AccessControl.FileSystemRights]::FullControl
        $OperatorSid = [int64][Security.AccessControl.FileSystemRights]::Modify
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
            throw "Precision Tools operator secrets CSV grants unexpected access"
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
            throw "Precision Tools operator secrets CSV rights contract is invalid"
        }
    }
}

function Get-ProtectedBackupPassword([string]$Path) {
    $matches = @(
        Import-Csv -LiteralPath $Path -Encoding UTF8 |
            Where-Object {
                [string]$_.key -ceq "PRECISION_TOOLS_BACKUP_PASSWORD"
            }
    )
    if ($matches.Count -ne 1) {
        throw (
            "Protected operator secrets CSV must contain exactly one " +
            "PRECISION_TOOLS_BACKUP_PASSWORD row"
        )
    }
    $value = [string]$matches[0].value
    if (
        [string]::IsNullOrWhiteSpace($value) -or
        $value.Length -lt 32 -or
        $value -match "[\r\n]"
    ) {
        throw "Protected backup password is missing or malformed"
    }
    return $value
}

function Assert-ProtectedBackupOutputRoot([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Protected backup output root was not found: $Path"
    }
    $mutationRights = [int64](
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
    $outputParent = Split-Path -Parent $Path
    $precisionToolsParent = Split-Path -Parent $outputParent
    foreach ($protectedPath in @(
        $precisionToolsParent,
        $outputParent,
        $Path
    )) {
        Assert-NoReparseComponents -Path $protectedPath `
            -Label "Protected backup output"
        $acl = Get-Acl -LiteralPath $protectedPath -ErrorAction Stop
        if (
            -not $acl.AreAccessRulesProtected -or
            $acl.GetOwner(
                [Security.Principal.SecurityIdentifier]
            ).Value -ne "S-1-5-32-544"
        ) {
            throw "Protected backup output ACL/owner contract is invalid"
        }
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
                throw "Protected backup output contains an unexpected access rule"
            }
            $sid = [string]$rule.IdentityReference.Value
            if (
                $sid -notin @(
                    "S-1-5-18",
                    "S-1-5-32-544"
                ) -and
                (([int64]$rule.FileSystemRights -band $mutationRights) -ne 0)
            ) {
                throw "Protected backup output grants untrusted mutation rights"
            }
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
                throw "Protected backup output lacks privileged FullControl"
            }
        }
    }
    Assert-NoReparseTree -Path $Path `
        -Label "Protected backup output tree"
}

function Remove-ProtectedRestoreWorkTree([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $runPrefix = $script:ExpectedProtectedWorkRoot.TrimEnd("\") + "\restore-"
    if (-not $fullPath.StartsWith(
        $runPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to clean a path outside the exact restore run-root contract"
    }
    Assert-NoReparseTree -Path $fullPath `
        -Label "Protected restore cleanup target"
    Remove-Item -LiteralPath $fullPath -Recurse -Force `
        -ErrorAction Stop
    if (Test-Path -LiteralPath $fullPath) {
        throw "Protected restore cleanup failed: $fullPath"
    }
}

function Get-FileSha256([string]$Path) {
    return (
        Get-FileHash -LiteralPath $Path -Algorithm SHA256
    ).Hash.ToLowerInvariant()
}

function Write-JsonFile($Object, [string]$Path) {
    Ensure-Directory (Split-Path -Parent $Path)
    Assert-NoReparseComponents -Path $Path -Label "Restore JSON output"
    if (Test-Path -LiteralPath $Path) {
        throw "Refusing to overwrite an existing restore JSON output: $Path"
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
            -Label "Restore JSON output staging file"
        [IO.File]::Move($temporaryPath, $Path)
        Assert-NoReparseTree -Path $Path -Label "Restore JSON output"
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
                -Label "Restore JSON cleanup target"
            Remove-Item -LiteralPath $temporaryPath -Force `
                -ErrorAction Stop
            if (Test-Path -LiteralPath $temporaryPath) {
                throw "Restore JSON cleanup failed: $temporaryPath"
            }
        }
    }
}

function Resolve-PythonExe {
    $candidate = if ([string]::IsNullOrWhiteSpace($PythonExe)) {
        [IO.Path]::GetFullPath($script:ExpectedRuntimePython)
    }
    else {
        [IO.Path]::GetFullPath($PythonExe)
    }
    if (-not $candidate.Equals(
        [IO.Path]::GetFullPath($script:ExpectedRuntimePython),
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Restore PythonExe must use the exact protected runtime interpreter"
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Protected restore runtime Python was not found"
    }
    Assert-NoReparseComponents -Path $candidate `
        -Label "Protected restore runtime Python"
    return $candidate
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

function Invoke-Native(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Name
) {
    $safeArgs = Format-ArgumentsForLog $Arguments
    Write-Log "Command: $FilePath $($safeArgs -join ' ')" "DEBUG"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Get-SidecarManifestPath([string]$ArchivePath) {
    $dir = Split-Path -Parent $ArchivePath
    $base = [IO.Path]::GetFileNameWithoutExtension($ArchivePath)
    return Join-Path $dir ($base + ".manifest.json")
}

function Get-RequiredArchiveHash([string]$ArchivePath) {
    Assert-NoReparseTree -Path $ArchivePath `
        -Label "Encrypted restore archive"
    $manifestPath = Get-SidecarManifestPath $ArchivePath
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Required backup sidecar manifest was not found: $manifestPath"
    }
    Assert-NoReparseTree -Path $manifestPath `
        -Label "Backup sidecar manifest"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    if ([string]$manifest.contract -cne $script:BackupContract) {
        throw "Backup sidecar manifest contract is invalid"
    }
    $fileName = Split-Path -Leaf $ArchivePath
    if (
        [string]$manifest.package -cne $fileName -or
        [string]$manifest.db_path -cne "backend/data/daiyujin.db"
    ) {
        throw "Backup sidecar manifest does not describe the selected archive"
    }
    $property = $manifest.sha256.PSObject.Properties[$fileName]
    if ($null -eq $property) {
        throw "Backup sidecar manifest has no SHA-256 entry for $fileName"
    }
    $expected = ([string]$property.Value).ToLowerInvariant()
    if ($expected -notmatch "^[0-9a-f]{64}$") {
        throw "Backup sidecar manifest contains an invalid SHA-256 value"
    }
    $actual = Get-FileSha256 $ArchivePath
    if ($actual -cne $expected) {
        throw "Backup hash mismatch. Expected $expected, got $actual"
    }
    Assert-NoReparseTree -Path $ArchivePath `
        -Label "Encrypted restore archive"
    Write-Log "Backup hash verified: $actual"
    return $expected
}

function Expand-ProtectedArchive(
    [string]$ArchivePath,
    [string]$OutputPath,
    [string]$ExpectedSha256
) {
    if (-not (Test-Path -LiteralPath $ProtectedArchiveScript -PathType Leaf)) {
        throw "Protected archive helper not found: $ProtectedArchiveScript"
    }
    Assert-NoReparseTree -Path $ProtectedArchiveScript `
        -Label "Protected archive helper"
    $py = Resolve-PythonExe
    Invoke-Native -FilePath $py -Arguments @(
        "-I", "-B", $ProtectedArchiveScript, "extract",
        "--archive", $ArchivePath,
        "--output", $OutputPath,
        "--expected-sha256", $ExpectedSha256
    ) -Name "Protected archive validation and extraction"
    Assert-NoReparseTree -Path $OutputPath `
        -Label "Extracted protected backup payload"
}

function Invoke-SqliteCheck([string]$DatabasePath, [string]$MetaPath) {
    if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) {
        throw "Restored database not found: $DatabasePath"
    }
    Assert-NoReparseTree -Path $DatabasePath `
        -Label "SQLite restore-check source"
    Ensure-Directory (Split-Path -Parent $MetaPath)
    $py = Resolve-PythonExe
    $scriptPath = Join-Path $RestoreRoot "sqlite_check.py"
    $code = @'
import argparse
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

REQUIRED = [
    "portal_users",
    "portal_orders",
    "portal_order_updates",
    "portal_order_media",
    "portal_messages",
    "portal_events",
]

parser = argparse.ArgumentParser()
parser.add_argument("--db", required=True)
parser.add_argument("--meta", required=True)
args = parser.parse_args()

con = sqlite3.connect(Path(args.db).resolve().as_uri() + "?mode=ro", uri=True)
try:
    existing = {row[0] for row in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    missing = [table for table in REQUIRED if table not in existing]
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    counts = {
        table: (
            None if table not in existing
            else con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        )
        for table in REQUIRED
    }
finally:
    con.close()

meta = {
    "checked_at": datetime.now().astimezone().isoformat(),
    "db": args.db,
    "db_size_bytes": os.path.getsize(args.db),
    "sqlite_integrity_check": integrity,
    "missing_tables": missing,
    "table_counts": counts,
}
with open(args.meta, "w", encoding="utf-8") as stream:
    json.dump(meta, stream, ensure_ascii=False, indent=2)
if missing:
    raise SystemExit("Missing required portal tables: " + ", ".join(missing))
if integrity != "ok":
    raise SystemExit("SQLite integrity_check failed: " + integrity)
'@
    Set-Content -LiteralPath $scriptPath -Value $code -Encoding UTF8
    Invoke-Native -FilePath $py -Arguments @(
        "-I", "-B", $scriptPath,
        "--db", $DatabasePath,
        "--meta", $MetaPath
    ) -Name "SQLite restore check"
    Assert-NoReparseTree -Path $DatabasePath `
        -Label "SQLite restore-check source"
    Assert-NoReparseTree -Path $MetaPath `
        -Label "SQLite restore-check metadata"
}

function Invoke-SqliteBackup([string]$SourceDb, [string]$OutputDb) {
    if (-not (Test-Path -LiteralPath $SourceDb -PathType Leaf)) {
        throw "Current database not found for required pre-restore backup: $SourceDb"
    }
    Assert-NoReparseTree -Path $SourceDb `
        -Label "Pre-restore SQLite source"
    Ensure-Directory (Split-Path -Parent $OutputDb)
    $py = Resolve-PythonExe
    $scriptPath = Join-Path $RestoreRoot "sqlite_backup.py"
    $code = @'
import argparse
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()

src = sqlite3.connect(
    Path(args.source).resolve().as_uri() + "?mode=ro",
    uri=True,
)
dst = sqlite3.connect(args.output)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()
'@
    Set-Content -LiteralPath $scriptPath -Value $code -Encoding UTF8
    Invoke-Native -FilePath $py -Arguments @(
        "-I", "-B", $scriptPath,
        "--source", $SourceDb,
        "--output", $OutputDb
    ) -Name "SQLite pre-restore backup"
    Assert-NoReparseTree -Path $SourceDb `
        -Label "Pre-restore SQLite source"
    Assert-NoReparseTree -Path $OutputDb `
        -Label "Protected pre-restore SQLite copy"
}

function Copy-IfExists([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) {
        Write-Log "Optional item not found, skipping: $Source" "WARN"
        return
    }
    Assert-NoReparseTree -Path $Source `
        -Label "Pre-restore payload source"
    Ensure-Directory (Split-Path -Parent $Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse
    Assert-NoReparseTree -Path $Source `
        -Label "Pre-restore payload source"
    Assert-NoReparseTree -Path $Destination `
        -Label "Protected pre-restore payload copy"
}

function Compress-ProtectedArchive([string]$SourceFolder, [string]$ArchivePath) {
    if (-not (Test-Path -LiteralPath $ProtectedArchiveScript -PathType Leaf)) {
        throw "Protected archive helper not found: $ProtectedArchiveScript"
    }
    Assert-NoReparseTree -Path $ProtectedArchiveScript `
        -Label "Protected archive helper"
    Assert-NoReparseTree -Path $SourceFolder `
        -Label "Protected pre-restore archive source"
    Assert-NoReparseComponents -Path $ArchivePath `
        -Label "Protected pre-restore archive destination"
    if (Test-Path -LiteralPath $ArchivePath) {
        throw "Refusing to overwrite an existing protected archive: $ArchivePath"
    }
    Ensure-Directory (Split-Path -Parent $ArchivePath)
    $py = Resolve-PythonExe
    Invoke-Native -FilePath $py -Arguments @(
        "-I", "-B", $ProtectedArchiveScript, "create",
        "--source", $SourceFolder,
        "--archive", $ArchivePath
    ) -Name "Protected pre-restore archive creation"
    Assert-NoReparseTree -Path $SourceFolder `
        -Label "Protected pre-restore archive source"
    Assert-NoReparseTree -Path $ArchivePath `
        -Label "Protected pre-restore archive output"
}

function New-PreRestoreBackup {
    $preDir = Join-Path $BackupRoot "pre_restore"
    Ensure-Directory $preDir
    $prePayload = Join-Path $RestoreRoot "pre_restore_payload"
    Ensure-Directory $prePayload
    $preDb = Join-Path $prePayload "backend\data\daiyujin.db"
    Invoke-SqliteBackup -SourceDb $DbPath -OutputDb $preDb
    $preMeta = Join-Path $RestoreRoot "pre-restore-db-check.json"
    Invoke-SqliteCheck -DatabasePath $preDb -MetaPath $preMeta
    foreach ($copy in @(
        @("backend\private\order_media", "backend\private\order_media"),
        @("backend\private\nextgen_handoff", "backend\private\nextgen_handoff"),
        @("backend\uploads", "backend\uploads"),
        @("backend\static\thumbnails", "backend\static\thumbnails"),
        @("backend\static\stl", "backend\static\stl")
    )) {
        Copy-IfExists -Source (Join-Path $ProjectRoot $copy[0]) `
            -Destination (Join-Path $prePayload $copy[1])
    }
    $packageName = "pre-restore-$Stamp.7z"
    Write-JsonFile -Object ([ordered]@{
        contract = $script:BackupContract
        created_at = (Get-Date).ToString("o")
        mode = "pre_restore"
        project_root = $ProjectRoot
        backup_root = $BackupRoot
        db_path = "backend/data/daiyujin.db"
        sqlite_integrity_check = "ok"
        package = $packageName
        sha256 = @{}
    }) -Path (Join-Path $prePayload "manifest.json")
    $preArchive = Join-Path $preDir $packageName
    Compress-ProtectedArchive -SourceFolder $prePayload `
        -ArchivePath $preArchive
    $hash = Get-FileSha256 $preArchive
    Write-JsonFile -Object ([ordered]@{
        contract = $script:BackupContract
        created_at = (Get-Date).ToString("o")
        mode = "pre_restore"
        project_root = $ProjectRoot
        backup_root = $BackupRoot
        db_path = "backend/data/daiyujin.db"
        sqlite_integrity_check = "ok"
        package = $packageName
        sha256 = @{ $packageName = $hash }
    }) -Path (Join-Path $preDir "pre-restore-$Stamp.manifest.json")
    Write-Log "Pre-restore backup created: $preArchive"
}

function Assert-InternalBackupContract([string]$Root, [string]$ArchivePath) {
    Assert-NoReparseTree -Path $Root `
        -Label "Extracted backup payload"
    $manifestPath = Join-Path $Root "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Backup payload is missing its required internal manifest"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    if (
        [string]$manifest.contract -cne $script:BackupContract -or
        [string]$manifest.db_path -cne "backend/data/daiyujin.db" -or
        [string]$manifest.sqlite_integrity_check -cne "ok" -or
        [string]$manifest.package -cne (Split-Path -Leaf $ArchivePath) -or
        [string]$manifest.mode -notin @(
            "daily",
            "weekly",
            "monthly",
            "pre_restore"
        )
    ) {
        throw "Backup payload internal manifest contract is invalid"
    }
    foreach ($suffix in @("-wal", "-shm")) {
        if (Test-Path -LiteralPath (
            Join-Path $Root "backend\data\daiyujin.db$suffix"
        )) {
            throw "Backup payload must not include live SQLite sidecar files"
        }
    }
}

function Resolve-PrincipalSid([string]$UserId) {
    try {
        if ($UserId -match "^S-\d-") {
            return [Security.Principal.SecurityIdentifier]::new($UserId).Value
        }
        return [Security.Principal.NTAccount]::new($UserId).Translate(
            [Security.Principal.SecurityIdentifier]
        ).Value
    }
    catch {
        throw "Could not resolve an approved writer task principal"
    }
}

function Assert-ApprovedWriterTaskDefinition(
    [object]$Task,
    [string]$TaskName
) {
    $runtime = (
        "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\" +
        "precision-tools\backup-runtime"
    )
    $expectedPrincipal = "S-1-5-19"
    $expectedWorkingDirectory = $ProjectRoot
    $expectedLauncher = switch ($TaskName) {
        "Daiyujin Precision Tools API" {
            Join-Path $ProjectRoot "run-api.ps1"
        }
        "Daiyujin Quote Worker" {
            Join-Path $ProjectRoot "run-quote-worker.ps1"
        }
        "Daiyujin Exchange Rate Update" {
            Join-Path $ProjectRoot "run-exchange-rate-update.ps1"
        }
        "Daiyujin Precision Tools Daily Backup" {
            $expectedPrincipal = "S-1-5-18"
            $expectedWorkingDirectory = $runtime
            Join-Path $runtime "Invoke-PrecisionToolsProtectedBackup.ps1"
        }
        "Daiyujin Precision Tools Weekly Backup" {
            $expectedPrincipal = "S-1-5-18"
            $expectedWorkingDirectory = $runtime
            Join-Path $runtime "Invoke-PrecisionToolsProtectedBackup.ps1"
        }
        default {
            throw "Unknown approved SQLite writer task name"
        }
    }
    $actions = @($Task.Actions)
    $powerShell = $script:ExpectedPowerShellExe
    $fileMarker = '-File "' + $expectedLauncher + '"'
    if (
        (Resolve-PrincipalSid ([string]$Task.Principal.UserId)) -ne
            $expectedPrincipal -or
        $actions.Count -ne 1 -or
        [string]$actions[0].Execute -ne $powerShell -or
        [string]$actions[0].WorkingDirectory -ne
            $expectedWorkingDirectory -or
        ([string]$actions[0].Arguments).IndexOf(
            $fileMarker,
            [StringComparison]::OrdinalIgnoreCase
        ) -lt 0
    ) {
        throw "An unowned task uses an approved SQLite writer task name: $TaskName"
    }
}

function Assert-ApprovedWritersStopped {
    if (-not $IHaveStoppedApi) {
        throw "Stop every approved SQLite writer first, then rerun with -IHaveStoppedApi"
    }
    foreach ($taskName in $script:ApprovedWriterTaskNames) {
        $task = Get-ScheduledTask -TaskName $taskName -TaskPath "\" `
            -ErrorAction SilentlyContinue
        if ($null -ne $task) {
            Assert-ApprovedWriterTaskDefinition -Task $task `
                -TaskName $taskName
            if ([string]$task.State -eq "Running") {
                throw "Approved SQLite writer task is still running: $taskName"
            }
        }
    }
    $writerPattern = (
        "(?i)(run-api\.ps1|run-quote-worker\.ps1|" +
        "run-exchange-rate-update\.ps1|" +
        "Invoke-PrecisionToolsProtectedBackup\.ps1|" +
        "Backup-OrderPortal\.ps1|waitress(?:\.exe)?|" +
        "run_quote_worker\.py|update_exchange_rates\.py)"
    )
    foreach ($process in Get-CimInstance -ClassName Win32_Process `
        -ErrorAction Stop) {
        if ([int]$process.ProcessId -eq $PID) {
            continue
        }
        $commandLine = [string]$process.CommandLine
        if (
            [string]::IsNullOrWhiteSpace($commandLine) -and
            [string]$process.Name -match
                "^(?i:python(?:w)?|powershell|pwsh)\.exe$"
        ) {
            throw (
                "Cannot positively identify a potential SQLite writer process: " +
                "PID $($process.ProcessId)"
            )
        }
        if (
            -not [string]::IsNullOrWhiteSpace($commandLine) -and
            $commandLine -match $writerPattern
        ) {
            throw (
                "Approved SQLite writer process is still running: PID " +
                "$($process.ProcessId)"
            )
        }
    }
    foreach ($path in @(
        $DbPath,
        "$DbPath-wal",
        "$DbPath-shm",
        $QuoteJobsDbPath,
        "$QuoteJobsDbPath-wal",
        "$QuoteJobsDbPath-shm"
    )) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            continue
        }
        Assert-NoReparseTree -Path $path `
            -Label "SQLite writer-stop probe"
        $stream = $null
        try {
            $stream = [IO.File]::Open(
                $path,
                [IO.FileMode]::Open,
                [IO.FileAccess]::ReadWrite,
                [IO.FileShare]::None
            )
        }
        catch {
            throw "SQLite file is still open or cannot be exclusively locked: $path"
        }
        finally {
            if ($null -ne $stream) {
                $stream.Dispose()
            }
        }
    }
}

function Disable-ApprovedWriterTasks {
    $reenable = [System.Collections.Generic.List[string]]::new()
    try {
        foreach ($taskName in $script:ApprovedWriterTaskNames) {
            $task = Get-ScheduledTask -TaskName $taskName -TaskPath "\" `
                -ErrorAction SilentlyContinue
            if ($null -eq $task) {
                continue
            }
            Assert-ApprovedWriterTaskDefinition -Task $task `
                -TaskName $taskName
            if ([string]$task.State -eq "Running") {
                throw "Approved SQLite writer task is still running: $taskName"
            }
            if ([string]$task.State -ne "Disabled") {
                Disable-ScheduledTask -TaskName $taskName -TaskPath "\" `
                    -ErrorAction Stop | Out-Null
                $disabled = Get-ScheduledTask -TaskName $taskName -TaskPath "\" `
                    -ErrorAction Stop
                if ([string]$disabled.State -ne "Disabled") {
                    throw "Could not disable approved SQLite writer task: $taskName"
                }
                $reenable.Add($taskName)
            }
        }
    }
    catch {
        $disableError = $_
        Restore-ApprovedWriterTasks -TaskNames $reenable.ToArray()
        throw $disableError
    }
    return $reenable.ToArray()
}

function Restore-ApprovedWriterTasks([string[]]$TaskNames) {
    $errors = [System.Collections.Generic.List[string]]::new()
    foreach ($taskName in $TaskNames) {
        try {
            Enable-ScheduledTask -TaskName $taskName -TaskPath "\" `
                -ErrorAction Stop | Out-Null
            $task = Get-ScheduledTask -TaskName $taskName -TaskPath "\" `
                -ErrorAction Stop
            if ([string]$task.State -eq "Disabled") {
                throw "task remains disabled"
            }
        }
        catch {
            $errors.Add("$taskName`: $($_.Exception.Message)")
        }
    }
    if ($errors.Count -gt 0) {
        throw "Approved SQLite writer task re-enable failed: $($errors -join '; ')"
    }
}

function Get-DirectorySnapshot([string]$Root) {
    Assert-NoReparseTree -Path $Root -Label "Directory snapshot source"
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
    $snapshot = [System.Collections.Generic.List[string]]::new()
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue([IO.Path]::GetFullPath($Root))
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
            if (
                ([IO.FileAttributes]$child.Attributes -band
                    [IO.FileAttributes]::ReparsePoint) -ne 0
            ) {
                throw "Directory snapshot source contains a reparse point"
            }
            $relative = $child.FullName.Substring($prefix.Length).Replace(
                "\",
                "/"
            )
            if ($child.PSIsContainer) {
                $snapshot.Add("D|$relative")
                $queue.Enqueue($child.FullName)
            }
            else {
                $snapshot.Add(
                    "F|$relative|$($child.Length)|$(Get-FileSha256 $child.FullName)"
                )
            }
        }
    }
    return @($snapshot.ToArray() | Sort-Object)
}

function Assert-DirectoryCopyEquivalent(
    [string]$Source,
    [string]$Destination
) {
    $sourceSnapshot = @(Get-DirectorySnapshot -Root $Source)
    $destinationSnapshot = @(Get-DirectorySnapshot -Root $Destination)
    if (
        $sourceSnapshot.Count -ne $destinationSnapshot.Count -or
        @(Compare-Object $sourceSnapshot $destinationSnapshot).Count -ne 0
    ) {
        throw "Transactional media staging copy verification failed"
    }
}

function Prepare-DirectoryRestore(
    [string]$RelativePath,
    [string]$TargetPath
) {
    $source = Join-Path $ExtractRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        Write-Log (
            "Backup does not include $RelativePath; leaving $TargetPath unchanged"
        ) "WARN"
        return $null
    }
    Assert-NoReparseTree -Path $source `
        -Label "Extracted media restore source"
    $target = [IO.Path]::GetFullPath($TargetPath)
    $parent = Split-Path -Parent $target
    Ensure-Directory $parent
    Assert-NoReparseComponents -Path $target `
        -Label "Production media target"
    $originalExists = Test-Path -LiteralPath $target
    if ($originalExists) {
        if (-not (Test-Path -LiteralPath $target -PathType Container)) {
            throw "Production media target is not a directory: $target"
        }
        Assert-NoReparseTree -Path $target `
            -Label "Production media target"
    }
    $leaf = Split-Path -Leaf $target
    $stage = Join-Path $parent (
        ".$leaf.restore-$TransactionId.staging"
    )
    $rollback = Join-Path $parent (
        ".$leaf.restore-$TransactionId.rollback"
    )
    foreach ($path in @($stage, $rollback)) {
        Assert-NoReparseComponents -Path $path `
            -Label "Transactional media path"
        if (Test-Path -LiteralPath $path) {
            throw "Transactional media path unexpectedly exists: $path"
        }
    }
    try {
        Copy-Item -LiteralPath $source -Destination $stage -Recurse
        Assert-NoReparseTree -Path $source `
            -Label "Extracted media restore source"
        Assert-DirectoryCopyEquivalent -Source $source -Destination $stage
    }
    catch {
        $stagingError = $_
        if (Test-Path -LiteralPath $stage) {
            Remove-LiveTransactionPath -Path $stage
        }
        throw $stagingError
    }
    return [pscustomobject]@{
        Source = $source
        Target = $target
        Stage = $stage
        Rollback = $rollback
        OriginalExists = [bool]$originalExists
        OriginalMoved = $false
        Committed = $false
    }
}

function Commit-DirectoryRestore([object]$State) {
    if ($State.OriginalExists) {
        Move-Item -LiteralPath $State.Target `
            -Destination $State.Rollback -ErrorAction Stop
        $State.OriginalMoved = $true
    }
    Move-Item -LiteralPath $State.Stage `
        -Destination $State.Target -ErrorAction Stop
    $State.Committed = $true
    Assert-NoReparseTree -Path $State.Target `
        -Label "Committed media restore target"
    Write-Log "Transactionally restored folder: $($State.Target)"
}

function Remove-LiveTransactionPath([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $projectPrefix = $ProjectRoot.TrimEnd("\") + "\"
    $approvedCommittedTargets = @(
        $DbPath,
        (Join-Path $BackendRoot "private\order_media"),
        (Join-Path $BackendRoot "private\nextgen_handoff"),
        (Join-Path $BackendRoot "uploads"),
        (Join-Path $BackendRoot "static\thumbnails"),
        (Join-Path $BackendRoot "static\stl")
    )
    $isApprovedCommittedTarget = $false
    foreach ($approvedTarget in $approvedCommittedTargets) {
        if ($fullPath.Equals(
            [IO.Path]::GetFullPath($approvedTarget),
            [StringComparison]::OrdinalIgnoreCase
        )) {
            $isApprovedCommittedTarget = $true
            break
        }
    }
    $isTransactionArtifact = (Split-Path -Leaf $fullPath) -match (
        "(?i)(^\.|\.restore-" +
        [Regex]::Escape($TransactionId) +
        "\.)"
    )
    if (
        -not $fullPath.StartsWith(
            $projectPrefix,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        (-not $isTransactionArtifact -and -not $isApprovedCommittedTarget)
    ) {
        throw "Refusing to remove a path outside the live restore transaction"
    }
    if (-not (Test-Path -LiteralPath $fullPath)) {
        return
    }
    Assert-NoReparseTree -Path $fullPath `
        -Label "Live restore transaction cleanup target"
    $item = Get-Item -LiteralPath $fullPath -Force
    if ($item.PSIsContainer) {
        Remove-Item -LiteralPath $fullPath -Recurse -Force `
            -ErrorAction Stop
    }
    else {
        Remove-Item -LiteralPath $fullPath -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $fullPath) {
        throw "Live restore transaction cleanup failed: $fullPath"
    }
}

function Prepare-DatabaseRestore([string]$SourceDb) {
    if (-not (Test-Path -LiteralPath $SourceDb -PathType Leaf)) {
        throw "Backup payload missing backend\data\daiyujin.db"
    }
    Assert-NoReparseTree -Path $SourceDb `
        -Label "Extracted database restore source"
    $parent = Split-Path -Parent $DbPath
    Ensure-Directory $parent
    Assert-NoReparseComponents -Path $DbPath `
        -Label "Production database target"
    if (Test-Path -LiteralPath $DbPath) {
        Assert-NoReparseTree -Path $DbPath `
            -Label "Production database target"
    }
    $stage = Join-Path $parent (
        ".daiyujin.db.restore-$TransactionId.staging"
    )
    $rollback = Join-Path $parent (
        ".daiyujin.db.restore-$TransactionId.rollback"
    )
    foreach ($path in @($stage, $rollback)) {
        if (Test-Path -LiteralPath $path) {
            throw "Transactional database path unexpectedly exists: $path"
        }
        Assert-NoReparseComponents -Path $path `
            -Label "Transactional database path"
    }
    try {
        Copy-Item -LiteralPath $SourceDb -Destination $stage
        Assert-NoReparseTree -Path $SourceDb `
            -Label "Extracted database restore source"
        if ((Get-FileSha256 $SourceDb) -cne (Get-FileSha256 $stage)) {
            throw "Transactional database staging copy hash mismatch"
        }
        Invoke-SqliteCheck -DatabasePath $stage `
            -MetaPath (Join-Path $RestoreRoot "staged-db-check.json")
    }
    catch {
        $stagingError = $_
        if (Test-Path -LiteralPath $stage) {
            Remove-LiveTransactionPath -Path $stage
        }
        throw $stagingError
    }
    $sidecars = @(
        foreach ($suffix in @("-wal", "-shm")) {
            [pscustomobject]@{
                Live = "$DbPath$suffix"
                Rollback = "$DbPath$suffix.restore-$TransactionId.rollback"
                OriginalMoved = $false
            }
        }
    )
    return [pscustomobject]@{
        Source = $SourceDb
        Stage = $stage
        Target = $DbPath
        Rollback = $rollback
        OriginalExists = [bool](Test-Path -LiteralPath $DbPath)
        Installed = $false
        Sidecars = $sidecars
    }
}

function Commit-DatabaseRestore([object]$State) {
    Assert-ApprovedWritersStopped
    foreach ($sidecar in $State.Sidecars) {
        if (Test-Path -LiteralPath $sidecar.Live) {
            Assert-NoReparseTree -Path $sidecar.Live `
                -Label "Production SQLite sidecar"
            if (Test-Path -LiteralPath $sidecar.Rollback) {
                throw "SQLite sidecar rollback path unexpectedly exists"
            }
            Move-Item -LiteralPath $sidecar.Live `
                -Destination $sidecar.Rollback -ErrorAction Stop
            $sidecar.OriginalMoved = $true
        }
    }
    if ($State.OriginalExists) {
        [IO.File]::Replace(
            $State.Stage,
            $State.Target,
            $State.Rollback,
            $true
        )
    }
    else {
        [IO.File]::Move($State.Stage, $State.Target)
    }
    $State.Installed = $true
    Invoke-SqliteCheck -DatabasePath $State.Target `
        -MetaPath (Join-Path $RestoreRoot "committed-db-check.json")
    Write-Log "Transactionally restored database: $($State.Target)"
}

function Rollback-DatabaseRestore([object]$State) {
    $errors = [System.Collections.Generic.List[string]]::new()
    if ($State.Installed) {
        try {
            if ($State.OriginalExists) {
                if (-not (Test-Path -LiteralPath $State.Rollback -PathType Leaf)) {
                    throw "Database rollback copy is missing"
                }
                if (Test-Path -LiteralPath $State.Target -PathType Leaf) {
                    [IO.File]::Replace(
                        $State.Rollback,
                        $State.Target,
                        $null,
                        $true
                    )
                }
                else {
                    [IO.File]::Move($State.Rollback, $State.Target)
                }
            }
            elseif (Test-Path -LiteralPath $State.Target) {
                Remove-LiveTransactionPath -Path $State.Target
            }
        }
        catch {
            $errors.Add("database rollback: $($_.Exception.Message)")
        }
    }
    foreach ($sidecar in $State.Sidecars) {
        try {
            if (Test-Path -LiteralPath $sidecar.Live) {
                Assert-NoReparseTree -Path $sidecar.Live `
                    -Label "New SQLite sidecar rollback cleanup"
                Remove-Item -LiteralPath $sidecar.Live -Force `
                    -ErrorAction Stop
            }
            if ($sidecar.OriginalMoved) {
                Move-Item -LiteralPath $sidecar.Rollback `
                    -Destination $sidecar.Live -ErrorAction Stop
            }
        }
        catch {
            $errors.Add("SQLite sidecar rollback: $($_.Exception.Message)")
        }
    }
    if ($errors.Count -gt 0) {
        throw ($errors -join "; ")
    }
}

function Rollback-DirectoryRestores([object[]]$States) {
    $errors = [System.Collections.Generic.List[string]]::new()
    for ($index = $States.Count - 1; $index -ge 0; $index--) {
        $state = $States[$index]
        try {
            if ($state.Committed -and (Test-Path -LiteralPath $state.Target)) {
                Remove-LiveTransactionPath -Path $state.Target
                $state.Committed = $false
            }
            if ($state.OriginalMoved) {
                Move-Item -LiteralPath $state.Rollback `
                    -Destination $state.Target -ErrorAction Stop
                $state.OriginalMoved = $false
            }
        }
        catch {
            $errors.Add(
                "media rollback for $($state.Target): $($_.Exception.Message)"
            )
        }
    }
    if ($errors.Count -gt 0) {
        throw ($errors -join "; ")
    }
}

function Remove-TransactionArtifacts(
    [object]$DatabaseState,
    [object[]]$DirectoryStates
) {
    if ($null -ne $DatabaseState) {
        foreach ($path in @(
            $DatabaseState.Stage,
            $DatabaseState.Rollback
        )) {
            if (Test-Path -LiteralPath $path) {
                Remove-LiveTransactionPath -Path $path
            }
        }
        foreach ($sidecar in $DatabaseState.Sidecars) {
            if (Test-Path -LiteralPath $sidecar.Rollback) {
                Remove-LiveTransactionPath -Path $sidecar.Rollback
            }
        }
    }
    foreach ($state in $DirectoryStates) {
        foreach ($path in @($state.Stage, $state.Rollback)) {
            if (Test-Path -LiteralPath $path) {
                Remove-LiveTransactionPath -Path $path
            }
        }
    }
}

$reenableTaskNames = @()
$writerTasksDisabled = $false
$databaseState = $null
$directoryStates = @()
$transactionCommitted = $false
$rollbackFailed = $false
$restoreSucceeded = $false
$backupPassword = $null
$backupPasswordInjected = $false
$runtimeLease = $null
$runtimeVerified = $false
try {
    if (-not (Test-Administrator)) {
        throw "Transactional Precision Tools restore requires elevated PowerShell"
    }
    $hostProcess = [Diagnostics.Process]::GetCurrentProcess()
    try {
        $hostProcessPath = [IO.Path]::GetFullPath(
            $hostProcess.MainModule.FileName
        )
    }
    finally {
        $hostProcess.Dispose()
    }
    if (-not $hostProcessPath.Equals(
        $script:ExpectedPowerShellExe,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Restore must run under the fixed Windows PowerShell executable"
    }
    Assert-NoReparseTree -Path $script:ExpectedPowerShellExe `
        -Label "Fixed Windows PowerShell executable"
    $runtimeManifestPath = Join-Path (
        $RuntimeBundleRoot
    ) $script:RuntimeManifestName
    $runtimeLease = [IO.File]::Open(
        $runtimeManifestPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    Assert-ProtectedRuntimeBundle -Root $RuntimeBundleRoot
    $runtimeVerified = $true
    foreach ($path in @(
        (Resolve-PythonExe),
        $ProtectedArchiveScript
    )) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Protected restore runtime input was not found: $path"
        }
        Assert-NoReparseTree -Path $path `
            -Label "Protected restore runtime input"
    }
    if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
        throw "Precision Tools external environment file was not found"
    }
    Assert-ProtectedEnvironmentFileAcl -Path $EnvironmentFile
    $operatorSid = (
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    )
    Assert-ProtectedSecretsCsvAcl -Path $SecretsCsvPath `
        -OperatorSid $operatorSid
    Assert-ProtectedBackupOutputRoot -Path $BackupRoot
    if ($null -ne [Environment]::GetEnvironmentVariable(
        "ORDER_PORTAL_BACKUP_PASSWORD",
        [EnvironmentVariableTarget]::Process
    )) {
        Remove-Item Env:ORDER_PORTAL_BACKUP_PASSWORD `
            -ErrorAction SilentlyContinue
        throw (
            "Inherited backup password environment input is rejected; " +
            "restore loads it only from the protected operator CSV"
        )
    }
    foreach ($name in @(
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "PYTHONUSERBASE",
        "PYTHONINSPECT"
    )) {
        if ($null -ne [Environment]::GetEnvironmentVariable(
            $name,
            [EnvironmentVariableTarget]::Process
        )) {
            throw "Inherited Python environment overrides are not allowed: $name"
        }
    }
    if ($RestoreEnv) {
        throw (
            "Environment restore is disabled. Re-materialize secrets from the " +
            "protected operator CSV instead of restoring a secret file from backup."
        )
    }
    Write-Host "Precision Tools transactional restore plan"
    Write-Host "  Runtime: protected, hash-verified ProgramData bundle"
    Write-Host "  Archive: protected ProgramData backup output"
    Write-Host "  Target: fixed Precision Tools production data paths"
    Write-Host "  Secret source: protected external CSV"
    if (
        -not $DryRun -and
        $Confirmation -cne "RESTORE_ORDER_PORTAL_TRANSACTION"
    ) {
        Write-Host (
            "Plan only. Re-run with -Confirmation " +
            "RESTORE_ORDER_PORTAL_TRANSACTION"
        )
        return
    }

    $backupPassword = Get-ProtectedBackupPassword -Path $SecretsCsvPath
    [Environment]::SetEnvironmentVariable(
        "ORDER_PORTAL_BACKUP_PASSWORD",
        $backupPassword,
        [EnvironmentVariableTarget]::Process
    )
    $backupPasswordInjected = $true
    Set-ProtectedWorkDirectoryAcl -Path $ProtectedWorkRoot
    Set-ProtectedWorkDirectoryAcl -Path $RestoreRoot
    Ensure-Directory $LogDir
    Write-Log "Starting transactional Order Portal restore"
    Write-Log "ProjectRoot: $ProjectRoot"
    Write-Log "BackupZip:   $BackupZip"
    Write-Log "DryRun:      $DryRun"

    $expectedHash = Get-RequiredArchiveHash -ArchivePath $BackupZip
    Expand-ProtectedArchive -ArchivePath $BackupZip `
        -OutputPath $ExtractRoot -ExpectedSha256 $expectedHash
    Assert-InternalBackupContract -Root $ExtractRoot `
        -ArchivePath $BackupZip
    $restoredDb = Join-Path $ExtractRoot "backend\data\daiyujin.db"
    Invoke-SqliteCheck -DatabasePath $restoredDb `
        -MetaPath (Join-Path $RestoreRoot "restore-check.json")

    if ($DryRun) {
        Write-Log "Dry-run restore validation succeeded; production was unchanged."
        return
    }

    Assert-ApprovedWritersStopped
    $reenableTaskNames = @(Disable-ApprovedWriterTasks)
    $writerTasksDisabled = $true
    Assert-ApprovedWritersStopped
    New-PreRestoreBackup

    if ($RestoreLocalMedia) {
        foreach ($mapping in @(
            @(
                "backend\private\order_media",
                (Join-Path $BackendRoot "private\order_media")
            ),
            @(
                "backend\private\nextgen_handoff",
                (Join-Path $BackendRoot "private\nextgen_handoff")
            ),
            @(
                "backend\uploads",
                (Join-Path $BackendRoot "uploads")
            ),
            @(
                "backend\static\thumbnails",
                (Join-Path $BackendRoot "static\thumbnails")
            ),
            @(
                "backend\static\stl",
                (Join-Path $BackendRoot "static\stl")
            )
        )) {
            $state = Prepare-DirectoryRestore `
                -RelativePath $mapping[0] -TargetPath $mapping[1]
            if ($null -ne $state) {
                $directoryStates += $state
            }
        }
    }
    else {
        Write-Log "Skipped local media/runtime folder restore."
    }
    $databaseState = Prepare-DatabaseRestore -SourceDb $restoredDb

    Assert-ApprovedWritersStopped
    try {
        foreach ($state in $directoryStates) {
            Commit-DirectoryRestore -State $state
        }
        Commit-DatabaseRestore -State $databaseState
        $transactionCommitted = $true
    }
    catch {
        $commitError = $_
        $rollbackErrors = [System.Collections.Generic.List[string]]::new()
        if ($null -ne $databaseState) {
            try {
                Rollback-DatabaseRestore -State $databaseState
            }
            catch {
                $rollbackErrors.Add($_.Exception.Message)
            }
        }
        try {
            Rollback-DirectoryRestores -States $directoryStates
        }
        catch {
            $rollbackErrors.Add($_.Exception.Message)
        }
        if ($rollbackErrors.Count -gt 0) {
            $rollbackFailed = $true
            throw (
                "Restore commit failed: $($commitError.Exception.Message). " +
                "Rollback also failed: $($rollbackErrors -join '; ')"
            )
        }
        throw $commitError
    }

    Remove-TransactionArtifacts -DatabaseState $databaseState `
        -DirectoryStates $directoryStates
    Write-Log (
        "Runtime secrets were not restored. Re-materialize the protected " +
        "external environment from the operator CSV when required."
    )
    Write-Log "Transactional restore completed and rollback artifacts were removed."
    $restoreSucceeded = $true
}
catch {
    if (
        $runtimeVerified -and
        $LogDir -and
        (Test-Path -LiteralPath $LogDir -PathType Container)
    ) {
        Write-Log $_.Exception.Message "ERROR"
    }
    throw
}
finally {
    $finalizationErrors = [System.Collections.Generic.List[string]]::new()
    if ($backupPasswordInjected) {
        try {
            Remove-Item Env:ORDER_PORTAL_BACKUP_PASSWORD `
                -ErrorAction Stop
            if ($null -ne [Environment]::GetEnvironmentVariable(
                "ORDER_PORTAL_BACKUP_PASSWORD",
                [EnvironmentVariableTarget]::Process
            )) {
                throw "Protected restore password environment cleanup failed"
            }
            $backupPasswordInjected = $false
        }
        catch {
            $finalizationErrors.Add(
                "backup password cleanup: $($_.Exception.Message)"
            )
        }
    }
    $backupPassword = $null
    if ($null -ne $runtimeLease) {
        try {
            $runtimeLease.Dispose()
            $runtimeLease = $null
        }
        catch {
            $finalizationErrors.Add(
                "protected runtime lease cleanup: $($_.Exception.Message)"
            )
        }
    }
    if (-not $transactionCommitted -and -not $rollbackFailed) {
        if ($null -ne $databaseState -or $directoryStates.Count -gt 0) {
            try {
                Remove-TransactionArtifacts -DatabaseState $databaseState `
                    -DirectoryStates $directoryStates
            }
            catch {
                $finalizationErrors.Add(
                    "transaction artifact cleanup: $($_.Exception.Message)"
                )
            }
        }
    }
    if ($writerTasksDisabled) {
        try {
            Restore-ApprovedWriterTasks -TaskNames $reenableTaskNames
            $writerTasksDisabled = $false
        }
        catch {
            $finalizationErrors.Add(
                "writer task restoration: $($_.Exception.Message)"
            )
        }
    }
    if (Test-Path -LiteralPath $RestoreRoot) {
        try {
            Remove-ProtectedRestoreWorkTree -Path $RestoreRoot
        }
        catch {
            $finalizationErrors.Add(
                "protected work cleanup: $($_.Exception.Message)"
            )
        }
    }
    if ($finalizationErrors.Count -gt 0) {
        throw "Restore finalization failed: $($finalizationErrors -join '; ')"
    }
}

if ($restoreSucceeded -and $StartApiAfterRestore) {
    $apiTaskName = "Daiyujin Precision Tools API"
    $apiTask = Get-ScheduledTask -TaskName $apiTaskName -TaskPath "\" `
        -ErrorAction Stop
    Assert-ApprovedWriterTaskDefinition -Task $apiTask `
        -TaskName $apiTaskName
    if ([string]$apiTask.State -eq "Disabled") {
        throw "Approved Precision Tools API task is disabled after restore"
    }
    Start-ScheduledTask -TaskName $apiTaskName -TaskPath "\" `
        -ErrorAction Stop
    Write-Host "Started approved Precision Tools API scheduled task."
}
elseif ($restoreSucceeded) {
    Write-Host "Start the approved Precision Tools API scheduled task when ready."
}
