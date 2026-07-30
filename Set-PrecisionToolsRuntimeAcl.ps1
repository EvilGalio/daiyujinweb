[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$OccPython = (
        "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
    ),
    [string]$RuntimeRoot = (
        "C:\ProgramData\Daiyujin\PrecisionTools\runtime"
    ),
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [string]$EnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env",
    [switch]$ValidateSecretsOnly
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

function Add-SidRule {
    param(
        [string]$Path,
        [string]$ContainmentRoot,
        [Security.Principal.SecurityIdentifier]$Sid,
        [Security.AccessControl.FileSystemRights]$Rights,
        [Security.AccessControl.InheritanceFlags]$Inheritance = (
            [Security.AccessControl.InheritanceFlags]::None
        )
    )
    $resolved = Assert-PrecisionToolsPathContained `
        -Path $Path `
        -Root $ContainmentRoot `
        -Label "Precision Tools ACL target"
    Assert-PrecisionToolsTrustedMutationAcl `
        -Path $resolved `
        -Label "Precision Tools ACL target" `
        -DeploymentOperatorSid $sourceOperatorSid
    $acl = Get-Acl -LiteralPath $Path
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $Sid,
        $Rights,
        $Inheritance,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $resolved -AclObject $acl
    [void](Assert-PrecisionToolsPathContained `
        -Path $resolved `
        -Root $ContainmentRoot `
        -Label "Precision Tools ACL target")
}

function Set-RuntimeDirectoryAcl {
    param(
        [string]$Path,
        [string]$ContainmentRoot,
        [Security.Principal.SecurityIdentifier]$RuntimeSid,
        [Security.Principal.SecurityIdentifier]$ReadOnlySid = $null
    )
    if (-not (Test-Path -LiteralPath $ContainmentRoot -PathType Container)) {
        throw "Precision Tools runtime containment root was not prepared"
    }
    $resolved = Assert-PrecisionToolsTrustedMutationAncestors `
        -Path $Path `
        -Root $ContainmentRoot `
        -Label "Precision Tools runtime directory" `
        -DeploymentOperatorSid $sourceOperatorSid
    [void](New-Item -ItemType Directory -Path $resolved -Force)
    [void](Assert-PrecisionToolsPathContained `
        -Path $resolved `
        -Root $ContainmentRoot `
        -Label "Precision Tools runtime directory")
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $full = [Security.AccessControl.FileSystemRights]::FullControl
    $modify = [Security.AccessControl.FileSystemRights]::Modify
    $operator = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sidValue in @(
        "S-1-5-18",
        "S-1-5-32-544",
        $operator.Value
    ) | Select-Object -Unique) {
        $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                $full,
                $inheritance,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        )
    }
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            $RuntimeSid,
            $modify,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            $allow
        )
    )
    if ($null -ne $ReadOnlySid) {
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $ReadOnlySid,
                [Security.AccessControl.FileSystemRights]::ReadAndExecute,
                $inheritance,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        )
    }
    Set-Acl -LiteralPath $resolved -AclObject $acl
    [void](Assert-PrecisionToolsPathContained `
        -Path $resolved `
        -Root $ContainmentRoot `
        -Label "Precision Tools runtime directory")
}

function Assert-ExactLegacyDirectoryAcl {
    param(
        [string]$Path,
        [Collections.IDictionary]$ExpectedRights,
        [string[]]$NonInheritingSids = @()
    )
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
        throw "Precision Tools legacy boundary ACL inheritance must be disabled"
    }
    if (
        $acl.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value -ne "S-1-5-32-544"
    ) {
        throw "Precision Tools legacy boundary owner must be Administrators"
    }
    $observedRights = @{}
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
            -not $ExpectedRights.Contains($sid)
        ) {
            throw "Precision Tools legacy boundary grants unexpected access"
        }
        $granted = [int64]$rule.FileSystemRights
        $approved = [int64]$ExpectedRights[$sid]
        if (($granted -band (-bnot $approved)) -ne 0) {
            throw "Precision Tools legacy boundary grants excessive rights"
        }
        if (
            $sid -in $NonInheritingSids -and
            (
                $rule.InheritanceFlags -ne
                    [Security.AccessControl.InheritanceFlags]::None -or
                $rule.PropagationFlags -ne
                    [Security.AccessControl.PropagationFlags]::None
            )
        ) {
            throw "Precision Tools legacy parent runtime access must not inherit"
        }
        if (
            $sid -notin $NonInheritingSids -and
            (
                $rule.InheritanceFlags -ne (
                    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
                    [Security.AccessControl.InheritanceFlags]::ObjectInherit
                ) -or
                $rule.PropagationFlags -ne
                    [Security.AccessControl.PropagationFlags]::None
            )
        ) {
            throw "Precision Tools legacy staging access must inherit"
        }
        $current = if ($observedRights.ContainsKey($sid)) {
            [int64]$observedRights[$sid]
        }
        else {
            [int64]0
        }
        $observedRights[$sid] = $current -bor $granted
    }
    foreach ($sid in $ExpectedRights.Keys) {
        if (-not $observedRights.ContainsKey($sid)) {
            throw "Precision Tools legacy boundary is missing an approved principal"
        }
        $required = [int64]$ExpectedRights[$sid]
        if (([int64]$observedRights[$sid] -band $required) -ne $required) {
            throw "Precision Tools legacy boundary is missing required rights"
        }
    }
}

function Set-LegacyHandoffBoundaryAcl {
    param(
        [string]$PrivateRoot,
        [string]$StagingRoot,
        [Security.Principal.SecurityIdentifier]$RuntimeSid,
        [Security.Principal.SecurityIdentifier]$PilotServiceSid = $null
    )
    $expectedPrivateRoot = [IO.Path]::GetFullPath(
        "C:\daiyujin\daiyujinweb\backend\private"
    )
    $expectedStagingRoot = [IO.Path]::GetFullPath(
        "C:\daiyujin\daiyujinweb\backend\private\nextgen_handoff"
    )
    if (
        -not [IO.Path]::GetFullPath($PrivateRoot).Equals(
            $expectedPrivateRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not [IO.Path]::GetFullPath($StagingRoot).Equals(
            $expectedStagingRoot,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Precision Tools legacy handoff paths do not match the fixed boundary"
    }
    if (-not (Test-Path -LiteralPath $PrivateRoot -PathType Container)) {
        throw "Precision Tools fixed private boundary is unavailable"
    }
    foreach ($path in @($PrivateRoot, $StagingRoot)) {
        if (Test-Path -LiteralPath $path) {
            Assert-PrecisionToolsNoReparsePoints -Path $path
        }
    }
    $systemSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
    $administratorsSid = [Security.Principal.SecurityIdentifier]::new(
        "S-1-5-32-544"
    )
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $inherit = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    $traverseRights = (
        [Security.AccessControl.FileSystemRights]::Traverse -bor
        [Security.AccessControl.FileSystemRights]::ReadAttributes -bor
        [Security.AccessControl.FileSystemRights]::Synchronize
    )
    $parentRights = [ordered]@{
        "S-1-5-18" = [Security.AccessControl.FileSystemRights]::FullControl
        "S-1-5-32-544" = [Security.AccessControl.FileSystemRights]::FullControl
        "S-1-5-19" = $traverseRights
    }
    if ($null -ne $PilotServiceSid) {
        $parentRights[$PilotServiceSid.Value] = $traverseRights
    }
    $parentAcl = [Security.AccessControl.DirectorySecurity]::new()
    $parentAcl.SetAccessRuleProtection($true, $false)
    $parentAcl.SetOwner($administratorsSid)
    foreach ($sid in @($systemSid, $administratorsSid)) {
        [void]$parentAcl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                [Security.AccessControl.FileSystemRights]::FullControl,
                $inherit,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        )
    }
    foreach ($sid in @($RuntimeSid, $PilotServiceSid)) {
        if ($null -eq $sid) {
            continue
        }
        [void]$parentAcl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                $traverseRights,
                [Security.AccessControl.InheritanceFlags]::None,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        )
    }
    Set-Acl -LiteralPath $PrivateRoot -AclObject $parentAcl
    $nonInheritingSids = @($RuntimeSid.Value)
    if ($null -ne $PilotServiceSid) {
        $nonInheritingSids += $PilotServiceSid.Value
    }
    Assert-ExactLegacyDirectoryAcl `
        -Path $PrivateRoot `
        -ExpectedRights $parentRights `
        -NonInheritingSids $nonInheritingSids

    if (-not (Test-Path -LiteralPath $StagingRoot -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $StagingRoot)
    }
    Assert-PrecisionToolsNoReparsePoints -Path $StagingRoot
    $stagingRights = [ordered]@{
        "S-1-5-18" = [Security.AccessControl.FileSystemRights]::FullControl
        "S-1-5-32-544" = [Security.AccessControl.FileSystemRights]::FullControl
        "S-1-5-19" = (
            [Security.AccessControl.FileSystemRights]::Modify -bor
            [Security.AccessControl.FileSystemRights]::Synchronize
        )
    }
    if ($null -ne $PilotServiceSid) {
        $stagingRights[$PilotServiceSid.Value] = (
            [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
            [Security.AccessControl.FileSystemRights]::Synchronize
        )
    }
    $stagingAcl = [Security.AccessControl.DirectorySecurity]::new()
    $stagingAcl.SetAccessRuleProtection($true, $false)
    $stagingAcl.SetOwner($administratorsSid)
    foreach ($sid in @($systemSid, $administratorsSid, $RuntimeSid, $PilotServiceSid)) {
        if ($null -eq $sid) {
            continue
        }
        [void]$stagingAcl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                $stagingRights[$sid.Value],
                $inherit,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        )
    }
    Set-Acl -LiteralPath $StagingRoot -AclObject $stagingAcl
    Assert-ExactLegacyDirectoryAcl `
        -Path $StagingRoot `
        -ExpectedRights $stagingRights

    $pendingItems = [Collections.Generic.Queue[object]]::new()
    foreach ($child in Get-ChildItem -LiteralPath $StagingRoot -Force) {
        $pendingItems.Enqueue($child)
    }
    while ($pendingItems.Count -gt 0) {
        $item = $pendingItems.Dequeue()
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "Precision Tools legacy staging tree contains a reparse point"
        }
        $itemAcl = Get-Acl -LiteralPath $item.FullName
        $ownerSid = $itemAcl.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -notin @("S-1-5-18", "S-1-5-19", "S-1-5-32-544")) {
            throw "Precision Tools legacy staging entry has an unexpected owner"
        }
        $observedRights = @{}
        foreach ($rule in $itemAcl.GetAccessRules(
            $true,
            $true,
            [Security.Principal.SecurityIdentifier]
        )) {
            $sid = [string]$rule.IdentityReference.Value
            if (
                $rule.AccessControlType -ne
                    [Security.AccessControl.AccessControlType]::Allow -or
                -not $stagingRights.Contains($sid)
            ) {
                throw "Precision Tools legacy staging entry grants unexpected access"
            }
            $granted = [int64]$rule.FileSystemRights
            $approved = [int64]$stagingRights[$sid]
            if (($granted -band (-bnot $approved)) -ne 0) {
                throw "Precision Tools legacy staging entry grants excessive rights"
            }
            $current = if ($observedRights.ContainsKey($sid)) {
                [int64]$observedRights[$sid]
            }
            else {
                [int64]0
            }
            $observedRights[$sid] = $current -bor $granted
        }
        foreach ($sid in $stagingRights.Keys) {
            $required = [int64]$stagingRights[$sid]
            if (
                -not $observedRights.ContainsKey($sid) -or
                (([int64]$observedRights[$sid] -band $required) -ne $required)
            ) {
                throw "Precision Tools legacy staging entry is missing required rights"
            }
        }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
                $pendingItems.Enqueue($child)
            }
        }
    }
}

function Assert-ProtectedSecretsCsvAcl {
    param(
        [string]$Path,
        [string]$ContainmentRoot,
        [Security.Principal.SecurityIdentifier]$OperatorSid
    )
    $resolved = Assert-PrecisionToolsPathContained `
        -Path $Path `
        -Root $ContainmentRoot `
        -Label "Precision Tools operator secrets CSV"
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Precision Tools operator secrets CSV was not found: $resolved"
    }
    Assert-PrecisionToolsNoReparsePoints -Path $resolved
    $acl = Get-Acl -LiteralPath $resolved
    if (-not $acl.AreAccessRulesProtected) {
        throw "Precision Tools operator secrets CSV ACL inheritance must be disabled"
    }
    $rules = $acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )
    $allowedSids = @(
        "S-1-5-18",
        "S-1-5-32-544",
        $OperatorSid.Value
    ) | Select-Object -Unique
    $observedRights = @{}
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne (
            [Security.AccessControl.AccessControlType]::Allow
        )) {
            throw "Precision Tools operator secrets CSV contains a deny access rule"
        }
        $sid = [string]$rule.IdentityReference.Value
        if ($sid -notin $allowedSids) {
            throw "Precision Tools operator secrets CSV grants access to an unexpected Windows principal"
        }
        $current = if ($observedRights.ContainsKey($sid)) {
            [int64]$observedRights[$sid]
        }
        else {
            [int64]0
        }
        $observedRights[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in @("S-1-5-18", "S-1-5-32-544")) {
        if (
            -not $observedRights.ContainsKey($sid) -or
            (([int64]$observedRights[$sid] -band $full) -ne $full)
        ) {
            throw "Precision Tools operator secrets CSV is missing protected FullControl"
        }
    }
    $operatorRights = [int64](
        [Security.AccessControl.FileSystemRights]::Modify -bor
        [Security.AccessControl.FileSystemRights]::Synchronize
    )
    if (
        -not $observedRights.ContainsKey($OperatorSid.Value) -or
        (([int64]$observedRights[$OperatorSid.Value] -band $operatorRights) -ne `
            $operatorRights) -or
        (([int64]$observedRights[$OperatorSid.Value] -band (-bnot $operatorRights)) -ne 0)
    ) {
        throw "Precision Tools operator secrets CSV must grant only Modify to the current operator"
    }
    $ownerSid = $acl.GetOwner(
        [Security.Principal.SecurityIdentifier]
    ).Value
    if ($ownerSid -notin @(
        "S-1-5-18",
        "S-1-5-32-544",
        $OperatorSid.Value
    )) {
        throw "Precision Tools operator secrets CSV has an untrusted owner"
    }
    Assert-PrecisionToolsNoReparsePoints -Path $resolved
}

if (-not (Test-Administrator)) {
    throw "Precision Tools runtime ACL configuration requires elevated PowerShell"
}
$scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = $scriptRoot
}
if (-not [IO.Path]::GetFullPath($ProjectRoot).Equals(
    $scriptRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Runtime ACL configuration requires the script's source root"
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
$environment = Assert-PrecisionToolsFixedEnvironmentPath -Path $EnvironmentFile
$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$operatorRoot = "C:\ProgramData\Daiyujin\Operator"
Assert-ProtectedSecretsCsvAcl `
    -Path ([IO.Path]::GetFullPath($SecretsCsvPath)) `
    -ContainmentRoot $operatorRoot `
    -OperatorSid $operatorSid
if ($ValidateSecretsOnly) {
    Write-Host "Precision Tools operator secrets CSV ACL: PASS"
    exit 0
}
$backendRoot = Join-Path $root "backend"
$backendPython = Join-Path $root ".venv\Scripts\python.exe"
$projectVenvRoot = Join-Path $root ".venv"
$dependencyRoot = "C:\ProgramData\Daiyujin\Dependencies"
$runtimeBase = "C:\ProgramData\Daiyujin\PrecisionTools"
$RuntimeRoot = Assert-PrecisionToolsPathContained `
    -Path ([IO.Path]::GetFullPath($RuntimeRoot)) `
    -Root $runtimeBase `
    -Label "Precision Tools runtime root"
if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) {
    Set-PrecisionToolsProtectedDirectoryAcl -Path $RuntimeRoot
}
else {
    Assert-PrecisionToolsNoReparsePoints -Path $RuntimeRoot
    Assert-PrecisionToolsTrustedMutationAcl `
        -Path $RuntimeRoot `
        -Label "Precision Tools runtime root" `
        -DeploymentOperatorSid $sourceOperatorSid
}
foreach ($path in @($backendRoot, $environment)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required Precision Tools runtime path was not found: $path"
    }
}
[void](Assert-PrecisionToolsTrustedExecutable `
    -Path $backendPython `
    -AllowedRoots @($projectVenvRoot) `
    -Label "Precision Tools backend Python" `
    -DeploymentOperatorSid $sourceOperatorSid)
$OccPython = Assert-PrecisionToolsTrustedExecutable `
    -Path $OccPython `
    -AllowedRoots @($dependencyRoot) `
    -Label "Precision Tools OCC Python" `
    -DeploymentOperatorSid $sourceOperatorSid
[void](Assert-PrecisionToolsProductionEnvironmentFile -Path $environment)

$runtimeSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-19")
$pilotServiceSid = $null
$pilotServiceUser = Get-LocalUser -Name "DYJDaiyujinPilotSvc" `
    -ErrorAction SilentlyContinue
if ($null -ne $pilotServiceUser) {
    try {
        $pilotServiceSid = [Security.Principal.NTAccount]::new(
            $env:COMPUTERNAME,
            "DYJDaiyujinPilotSvc"
        ).Translate([Security.Principal.SecurityIdentifier])
    }
    catch {
        throw "The fixed NextGen public-pilot account SID cannot be resolved"
    }
}
$fixedPrivateRoot = "C:\daiyujin\daiyujinweb\backend\private"
$handoffStagingRoot = Assert-PrecisionToolsPathContained `
    -Path "C:\daiyujin\daiyujinweb\backend\private\nextgen_handoff" `
    -Root $fixedPrivateRoot `
    -Label "Precision Tools NextGen handoff staging directory"
Set-LegacyHandoffBoundaryAcl `
    -PrivateRoot $fixedPrivateRoot `
    -StagingRoot $handoffStagingRoot `
    -RuntimeSid $runtimeSid `
    -PilotServiceSid $pilotServiceSid

$readExecute = [Security.AccessControl.FileSystemRights]::ReadAndExecute
$inherit = (
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
)
Add-SidRule -Path $root -ContainmentRoot $root `
    -Sid $runtimeSid -Rights $readExecute `
    -Inheritance $inherit
Add-SidRule -Path $projectVenvRoot -ContainmentRoot $root `
    -Sid $runtimeSid `
    -Rights $readExecute -Inheritance $inherit
Add-SidRule -Path (Split-Path -Parent $OccPython) `
    -ContainmentRoot $dependencyRoot `
    -Sid $runtimeSid `
    -Rights $readExecute -Inheritance $inherit

$runtimeDirectories = @(
    (Join-Path $backendRoot "data"),
    (Join-Path $backendRoot "uploads"),
    (Join-Path $backendRoot "static\thumbnails"),
    (Join-Path $backendRoot "static\stl"),
    (Join-Path $backendRoot "private\order_media"),
    (Join-Path $RuntimeRoot "logs"),
    (Join-Path $RuntimeRoot "temp")
)
foreach ($directory in $runtimeDirectories) {
    $containmentRoot = if ($directory.StartsWith(
        $backendRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        $backendRoot
    }
    elseif ($directory.StartsWith(
        $RuntimeRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        $RuntimeRoot
    }
    else {
        $fixedPrivateRoot
    }
    Set-RuntimeDirectoryAcl `
        -Path $directory `
        -ContainmentRoot $containmentRoot `
        -RuntimeSid $runtimeSid
}

Write-Host "Precision Tools LocalService runtime ACL: READY"
Write-Host "Runtime root: $RuntimeRoot"
