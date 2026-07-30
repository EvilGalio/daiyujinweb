Set-StrictMode -Version Latest

$script:PrecisionToolsProductionEnvironmentFile = "C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env"
$script:PrecisionToolsRuntimeSidValue = "S-1-5-19"
$script:PrecisionToolsSystemSidValue = "S-1-5-18"
$script:PrecisionToolsAdministratorsSidValue = "S-1-5-32-544"
$script:PrecisionToolsProgramDataRoot = "C:\ProgramData\Daiyujin"
$script:PrecisionToolsRequiredProductionEnvironmentKeys = @(
    "BACKEND_PYTHON",
    "OCC_PYTHON",
    "SECRET_KEY",
    "ADMIN_SECRET_KEY",
    "QUOTE_HANDOFF_SIGNING_SECRET",
    "NEXTGEN_LEGACY_HANDOFF_SECRET",
    "NEXTGEN_API_BASE_URL",
    "NEXTGEN_COMPANY_CODE",
    "NEXTGEN_CUSTOMER_PORTAL_URL",
    "NEXTGEN_HANDOFF_STAGING_ROOT",
    "ALLOWED_ORIGINS",
    "QUOTE_ASYNC_ARCHIVES_ENABLED",
    "QUOTE_CAD_CONCURRENCY"
)
$script:PrecisionToolsOptionalProductionEnvironmentKeys = @(
    "PORTAL_R2_MAX_FILE_MB",
    "PORTAL_R2_SOFT_QUOTA_GB",
    "PORTAL_TICKET_SECRET",
    "QUOTE_CAD_TIMEOUT_SECONDS",
    "QUOTE_CLIENT_HASH_SALT",
    "QUOTE_EMAIL_ALLOWED_SITES",
    "QUOTE_EMAIL_ENABLED",
    "QUOTE_EMAIL_RECIPIENTS",
    "QUOTE_FILE_RECEIPT_TTL_SECONDS",
    "QUOTE_JOBS_DB_PATH",
    "QUOTE_JOB_MAINTENANCE_FILE",
    "QUOTE_JOB_MIN_FREE_BYTES",
    "QUOTE_JOB_STORAGE_ROOT",
    "QUOTE_JOB_TTL_HOURS",
    "QUOTE_MAX_ACTIVE_JOBS",
    "QUOTE_MAX_CLIENT_JOBS",
    "QUOTE_MAX_QUEUED_PARTS",
    "QUOTE_PREVIEW_HEIGHT",
    "QUOTE_PREVIEW_WATERMARK",
    "QUOTE_PREVIEW_WATERMARK_ANGLE",
    "QUOTE_PREVIEW_WATERMARK_OPACITY",
    "QUOTE_PREVIEW_WATERMARK_SPACING",
    "QUOTE_PREVIEW_WIDTH",
    "QUOTE_REFERENCE_TTL_SECONDS",
    "QUOTE_REQUIRE_WORKER_HEALTH",
    "QUOTE_STAGING_CLEANUP_AGE_SECONDS",
    "R2_ACCESS_KEY_ID",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_ENDPOINT_URL",
    "R2_REGION",
    "R2_SECRET_ACCESS_KEY",
    "RAR_EXTRACTION_TOOL",
    "SMTP_FROM",
    "SMTP_FROM_NAME",
    "SMTP_HOST",
    "SMTP_PASSWORD",
    "SMTP_PORT",
    "SMTP_TIMEOUT_SECONDS",
    "SMTP_USERNAME",
    "TOLERANCE_ALLOW_FORMULA_FALLBACK"
)
$script:PrecisionToolsApplicationEnvironmentKeys = @(
    $script:PrecisionToolsRequiredProductionEnvironmentKeys
    $script:PrecisionToolsOptionalProductionEnvironmentKeys
) | Sort-Object -Unique
$script:PrecisionToolsInheritedEnvironmentKeysToClear = @(
    $script:PrecisionToolsApplicationEnvironmentKeys
    "DATABASE_URL"
    "PRECISION_TOOLS_ENVIRONMENT_FILE"
    "PRECISION_TOOLS_ADMIN_PASSWORD"
    "PRECISION_TOOLS_ALLOW_INSECURE_DEV_SEED"
    "PRECISION_TOOLS_PRODUCTION"
    "PYTHONBREAKPOINT"
    "PYTHONHOME"
    "PYTHONINSPECT"
    "PYTHONPATH"
    "PYTHONSTARTUP"
    "PYTHONUSERBASE"
    "VIRTUAL_ENV"
) | Sort-Object -Unique

function Get-PrecisionToolsProductionEnvironmentFile {
    return $script:PrecisionToolsProductionEnvironmentFile
}

function Assert-PrecisionToolsFixedEnvironmentPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (
        [string]::IsNullOrWhiteSpace($Path) -or
        -not [IO.Path]::IsPathRooted($Path)
    ) {
        throw "Precision Tools production EnvironmentFile must be an absolute path"
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    $expected = [IO.Path]::GetFullPath(
        $script:PrecisionToolsProductionEnvironmentFile
    )
    if (-not $resolved.Equals(
        $expected,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Precision Tools production EnvironmentFile must use the fixed company path"
    }
    return $resolved
}

function Assert-PrecisionToolsNoReparsePoints {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($resolved)
    $current = $root
    $relative = $resolved.Substring($root.Length)
    foreach ($segment in $relative.Split(
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
            throw "Precision Tools protected environment path contains a reparse point"
        }
    }
}

function Assert-PrecisionToolsPathContained {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$Label = "Precision Tools path"
    )

    if (
        [string]::IsNullOrWhiteSpace($Path) -or
        [string]::IsNullOrWhiteSpace($Root) -or
        -not [IO.Path]::IsPathRooted($Path) -or
        -not [IO.Path]::IsPathRooted($Root)
    ) {
        throw "$Label and its containment root must be absolute paths"
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $rootPrefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
    if (
        -not $resolved.Equals(
            $resolvedRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        -not $resolved.StartsWith(
            $rootPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "$Label escapes its approved containment root"
    }
    Assert-PrecisionToolsNoReparsePoints -Path $resolvedRoot
    Assert-PrecisionToolsNoReparsePoints -Path $resolved
    return $resolved
}

function Test-PrecisionToolsDeploymentOperatorSid {
    param([AllowEmptyString()][string]$Sid)

    return (
        -not [string]::IsNullOrWhiteSpace($Sid) -and
        $Sid -match "^S-1-5-21-(?:\d+-){3}\d+$"
    )
}

function Get-PrecisionToolsTrustedPrincipalSids {
    param([AllowEmptyString()][string]$DeploymentOperatorSid = "")

    $trusted = [System.Collections.Generic.List[string]]::new()
    foreach ($sid in @(
        $script:PrecisionToolsSystemSidValue,
        $script:PrecisionToolsAdministratorsSidValue
    ) | Select-Object -Unique) {
        $trusted.Add([string]$sid)
    }
    if (-not [string]::IsNullOrWhiteSpace($DeploymentOperatorSid)) {
        if (-not (Test-PrecisionToolsDeploymentOperatorSid `
            -Sid $DeploymentOperatorSid)) {
            throw "Precision Tools deployment operator SID is not an interactive user"
        }
        $trusted.Add($DeploymentOperatorSid)
    }
    else {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        if (
            (Test-PrecisionToolsDeploymentOperatorSid -Sid $identity.User.Value) -and
            $principal.IsInRole(
                [Security.Principal.WindowsBuiltInRole]::Administrator
            )
        ) {
            $trusted.Add($identity.User.Value)
        }
    }
    try {
        $trustedInstaller = [Security.Principal.NTAccount]::new(
            "NT SERVICE",
            "TrustedInstaller"
        ).Translate([Security.Principal.SecurityIdentifier]).Value
        if ($trustedInstaller -notin $trusted) {
            $trusted.Add($trustedInstaller)
        }
    }
    catch {
        # TrustedInstaller is unavailable on non-Windows parser/test hosts.
    }
    return @($trusted.ToArray() | Select-Object -Unique)
}

function Assert-PrecisionToolsTrustedMutationAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Label = "Precision Tools trusted path",
        [AllowEmptyString()][string]$DeploymentOperatorSid = ""
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label was not found"
    }
    Assert-PrecisionToolsNoReparsePoints -Path $Path
    $acl = Get-Acl -LiteralPath $Path
    $trustedSids = @(
        Get-PrecisionToolsTrustedPrincipalSids `
            -DeploymentOperatorSid $DeploymentOperatorSid
    )
    $ownerSid = Get-PrecisionToolsOwnerSid -Acl $acl
    if ($ownerSid -notin $trustedSids) {
        throw "$Label has an untrusted owner"
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
    $rules = $acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )
    foreach ($rule in $rules) {
        if (
            $rule.AccessControlType -eq
                [Security.AccessControl.AccessControlType]::Allow -and
            [string]$rule.IdentityReference.Value -notin $trustedSids -and
            (([int64]$rule.FileSystemRights -band $writeRights) -ne 0)
        ) {
            throw "$Label grants mutation rights to an untrusted principal"
        }
    }
}

function Assert-PrecisionToolsTrustedMutationAncestors {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$Label = "Precision Tools mutation target",
        [AllowEmptyString()][string]$DeploymentOperatorSid = ""
    )

    $resolved = Assert-PrecisionToolsPathContained `
        -Path $Path `
        -Root $Root `
        -Label $Label
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $targetParent = Split-Path -Parent $resolved
    $current = $resolvedRoot
    if (Test-Path -LiteralPath $current -PathType Container) {
        Assert-PrecisionToolsTrustedMutationAcl `
            -Path $current `
            -Label $Label `
            -DeploymentOperatorSid $DeploymentOperatorSid
    }
    $relativeParent = $targetParent.Substring($resolvedRoot.Length).TrimStart(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    foreach ($segment in $relativeParent.Split(
        [char[]]@('\', '/'),
        [StringSplitOptions]::RemoveEmptyEntries
    )) {
        $current = Join-Path $current $segment
        if (Test-Path -LiteralPath $current -PathType Container) {
            Assert-PrecisionToolsTrustedMutationAcl `
                -Path $current `
                -Label $Label `
                -DeploymentOperatorSid $DeploymentOperatorSid
        }
    }
    return $resolved
}

function Assert-PrecisionToolsTrustedExecutable {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$AllowedRoots,
        [string]$Label = "Precision Tools executable",
        [AllowEmptyString()][string]$DeploymentOperatorSid = ""
    )

    if (
        [string]::IsNullOrWhiteSpace($Path) -or
        -not [IO.Path]::IsPathRooted($Path)
    ) {
        throw "$Label must be an explicit absolute path"
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "$Label was not found"
    }
    $approvedRoot = $null
    foreach ($candidateRoot in $AllowedRoots) {
        if ([string]::IsNullOrWhiteSpace($candidateRoot)) {
            continue
        }
        $root = [IO.Path]::GetFullPath($candidateRoot).TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        )
        $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
        if (
            $resolved.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
            $resolved.StartsWith(
                $rootPrefix,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            $approvedRoot = $root
            break
        }
    }
    if ($null -eq $approvedRoot) {
        throw "$Label is outside the approved production roots"
    }
    [void](Assert-PrecisionToolsPathContained `
        -Path $resolved `
        -Root $approvedRoot `
        -Label $Label)

    $current = $approvedRoot
    Assert-PrecisionToolsTrustedMutationAcl `
        -Path $current `
        -Label $Label `
        -DeploymentOperatorSid $DeploymentOperatorSid
    $relative = $resolved.Substring($approvedRoot.Length).TrimStart(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    foreach ($segment in $relative.Split(
        [char[]]@('\', '/'),
        [StringSplitOptions]::RemoveEmptyEntries
    )) {
        $current = Join-Path $current $segment
        Assert-PrecisionToolsTrustedMutationAcl `
            -Path $current `
            -Label $Label `
            -DeploymentOperatorSid $DeploymentOperatorSid
    }
    return $resolved
}

function Assert-PrecisionToolsTrustedSourceFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [string]$Label = "Precision Tools source file",
        [AllowEmptyString()][string]$DeploymentOperatorSid = ""
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label was not found"
    }
    $resolved = Assert-PrecisionToolsPathContained `
        -Path $Path `
        -Root $SourceRoot `
        -Label $Label
    $root = [IO.Path]::GetFullPath($SourceRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $current = $root
    Assert-PrecisionToolsTrustedMutationAcl `
        -Path $current `
        -Label $Label `
        -DeploymentOperatorSid $DeploymentOperatorSid
    $relative = $resolved.Substring($root.Length).TrimStart(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    foreach ($segment in $relative.Split(
        [char[]]@('\', '/'),
        [StringSplitOptions]::RemoveEmptyEntries
    )) {
        $current = Join-Path $current $segment
        Assert-PrecisionToolsTrustedMutationAcl `
            -Path $current `
            -Label $Label `
            -DeploymentOperatorSid $DeploymentOperatorSid
    }
    return $resolved
}

function Get-PrecisionToolsOwnerSid {
    param([Parameter(Mandatory = $true)][object]$Acl)

    return $Acl.GetOwner(
        [Security.Principal.SecurityIdentifier]
    ).Value
}

function Assert-PrecisionToolsProtectedStagingAccessRules {
    param([Parameter(Mandatory = $true)][object]$Acl)

    if (-not $Acl.AreAccessRulesProtected) {
        throw "Precision Tools environment staging ACL inheritance must be disabled"
    }
    if (
        (Get-PrecisionToolsOwnerSid -Acl $Acl) -ne
        $script:PrecisionToolsAdministratorsSidValue
    ) {
        throw "Precision Tools environment staging owner must be Administrators"
    }
    $allowedSids = @(
        $script:PrecisionToolsSystemSidValue,
        $script:PrecisionToolsAdministratorsSidValue
    )
    $observedRights = @{}
    foreach ($rule in $Acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )) {
        if (
            $rule.IsInherited -or
            $rule.AccessControlType -ne
                [Security.AccessControl.AccessControlType]::Allow -or
            [string]$rule.IdentityReference.Value -notin $allowedSids
        ) {
            throw "Precision Tools environment staging grants unexpected access"
        }
        $sid = [string]$rule.IdentityReference.Value
        $current = if ($observedRights.ContainsKey($sid)) {
            [int64]$observedRights[$sid]
        }
        else {
            [int64]0
        }
        $observedRights[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in $allowedSids) {
        if (
            -not $observedRights.ContainsKey($sid) -or
            (([int64]$observedRights[$sid] -band $full) -ne $full)
        ) {
            throw "Precision Tools environment staging is missing protected FullControl"
        }
    }
}

function Assert-PrecisionToolsProtectedAccessRules {
    param(
        [Parameter(Mandatory = $true)][object]$Acl,
        [Parameter(Mandatory = $true)]
        [Security.AccessControl.FileSystemRights]$RuntimeRequiredRights
    )

    if (-not $Acl.AreAccessRulesProtected) {
        throw "Precision Tools production environment ACL inheritance must be disabled"
    }
    if (
        (Get-PrecisionToolsOwnerSid -Acl $Acl) -ne
        $script:PrecisionToolsAdministratorsSidValue
    ) {
        throw "Precision Tools production environment owner must be Administrators"
    }
    $rules = $Acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )
    $allowedSids = @(
        $script:PrecisionToolsSystemSidValue,
        $script:PrecisionToolsAdministratorsSidValue,
        $script:PrecisionToolsRuntimeSidValue
    )
    $observedRights = @{}
    foreach ($rule in $rules) {
        if ($rule.IsInherited) {
            throw "Precision Tools production environment contains an inherited rule"
        }
        if (
            $rule.AccessControlType -ne
            [Security.AccessControl.AccessControlType]::Allow
        ) {
            throw "Precision Tools production environment contains a deny rule"
        }
        $sid = [string]$rule.IdentityReference.Value
        if ($sid -notin $allowedSids) {
            throw "Precision Tools production environment grants an unexpected principal"
        }
        $current = if ($observedRights.ContainsKey($sid)) {
            [int64]$observedRights[$sid]
        }
        else {
            [int64]0
        }
        $observedRights[$sid] = (
            $current -bor [int64]$rule.FileSystemRights
        )
    }

    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in @(
        $script:PrecisionToolsSystemSidValue,
        $script:PrecisionToolsAdministratorsSidValue
    )) {
        if (
            -not $observedRights.ContainsKey($sid) -or
            (([int64]$observedRights[$sid] -band $full) -ne $full)
        ) {
            throw "Precision Tools production environment is missing protected FullControl"
        }
    }

    $runtimeSid = $script:PrecisionToolsRuntimeSidValue
    $required = [int64]$RuntimeRequiredRights
    if (
        -not $observedRights.ContainsKey($runtimeSid) -or
        (([int64]$observedRights[$runtimeSid] -band $required) -ne $required)
    ) {
        throw "Precision Tools production environment is not readable by LocalService"
    }
    $writeRights = [int64](
        [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    if (
        (([int64]$observedRights[$runtimeSid] -band $writeRights) -ne 0)
    ) {
        throw "Precision Tools production environment grants write access to LocalService"
    }
}

function Set-PrecisionToolsProtectedDirectoryAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    Assert-PrecisionToolsNoReparsePoints -Path $Path
    if (Test-Path -LiteralPath $Path) {
        if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
            throw "Precision Tools protected directory path is not a directory"
        }
    }
    else {
        [void](New-Item -ItemType Directory -Path $Path)
    }
    Assert-PrecisionToolsNoReparsePoints -Path $Path

    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $system = [Security.Principal.SecurityIdentifier]::new(
        $script:PrecisionToolsSystemSidValue
    )
    $administrators = [Security.Principal.SecurityIdentifier]::new(
        $script:PrecisionToolsAdministratorsSidValue
    )
    $runtime = [Security.Principal.SecurityIdentifier]::new(
        $script:PrecisionToolsRuntimeSidValue
    )
    $acl.SetOwner($administrators)
    foreach ($sid in @($system, $administrators)) {
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                [Security.AccessControl.FileSystemRights]::FullControl,
                $inheritance,
                $propagation,
                $allow
            )
        )
    }
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            $runtime,
            [Security.AccessControl.FileSystemRights]::ReadAndExecute,
            $inheritance,
            $propagation,
            $allow
        )
    )
    Set-Acl -LiteralPath $Path -AclObject $acl
    $actual = Get-Acl -LiteralPath $Path
    Assert-PrecisionToolsProtectedAccessRules `
        -Acl $actual `
        -RuntimeRequiredRights (
            [Security.AccessControl.FileSystemRights]::ReadAndExecute
        )
}

function Set-PrecisionToolsProtectedStagingDirectoryAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    Assert-PrecisionToolsNoReparsePoints -Path $Path
    [void](New-Item -ItemType Directory -Path $Path -Force)
    Assert-PrecisionToolsNoReparsePoints -Path $Path

    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner(
        [Security.Principal.SecurityIdentifier]::new(
            $script:PrecisionToolsAdministratorsSidValue
        )
    )
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    foreach ($sidValue in @(
        $script:PrecisionToolsSystemSidValue,
        $script:PrecisionToolsAdministratorsSidValue
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
    Assert-PrecisionToolsNoReparsePoints -Path $Path
    Assert-PrecisionToolsProtectedStagingAccessRules `
        -Acl (Get-Acl -LiteralPath $Path)
}

function Set-PrecisionToolsProtectedStagingFileAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Precision Tools environment staging file was not found"
    }
    Assert-PrecisionToolsNoReparsePoints -Path $Path
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner(
        [Security.Principal.SecurityIdentifier]::new(
            $script:PrecisionToolsAdministratorsSidValue
        )
    )
    foreach ($sidValue in @(
        $script:PrecisionToolsSystemSidValue,
        $script:PrecisionToolsAdministratorsSidValue
    )) {
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new($sidValue),
                [Security.AccessControl.FileSystemRights]::FullControl,
                [Security.AccessControl.AccessControlType]::Allow
            )
        )
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
    Assert-PrecisionToolsProtectedStagingAccessRules `
        -Acl (Get-Acl -LiteralPath $Path)
}

function Initialize-PrecisionToolsEnvironmentLayout {
    param([Parameter(Mandatory = $true)][string]$EnvironmentPath)

    $resolved = Assert-PrecisionToolsFixedEnvironmentPath -Path $EnvironmentPath
    $parent = Split-Path -Parent $resolved
    $approvedRoot = [IO.Path]::GetFullPath(
        $script:PrecisionToolsProgramDataRoot
    ).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    if (-not (Test-Path -LiteralPath $approvedRoot -PathType Container)) {
        throw "Precision Tools ProgramData root must be prepared before environment creation"
    }
    $parent = Assert-PrecisionToolsPathContained `
        -Path $parent `
        -Root $approvedRoot `
        -Label "Precision Tools environment parent"

    $current = $approvedRoot
    Assert-PrecisionToolsTrustedMutationAcl `
        -Path $current `
        -Label "Precision Tools environment ancestor"
    $relativeParent = $parent.Substring($approvedRoot.Length).TrimStart(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    foreach ($segment in $relativeParent.Split(
        [char[]]@('\', '/'),
        [StringSplitOptions]::RemoveEmptyEntries
    )) {
        Assert-PrecisionToolsNoReparsePoints -Path $current
        Assert-PrecisionToolsTrustedMutationAcl `
            -Path $current `
            -Label "Precision Tools environment ancestor"
        $next = Join-Path $current $segment
        if (Test-Path -LiteralPath $next) {
            if (-not (Test-Path -LiteralPath $next -PathType Container)) {
                throw "Precision Tools environment ancestor is not a directory"
            }
            Assert-PrecisionToolsNoReparsePoints -Path $next
            Assert-PrecisionToolsTrustedMutationAcl `
                -Path $next `
                -Label "Precision Tools environment ancestor"
        }
        else {
            [void](New-Item -ItemType Directory -Path $next)
            Assert-PrecisionToolsNoReparsePoints -Path $next
            Set-PrecisionToolsProtectedDirectoryAcl -Path $next
            Assert-PrecisionToolsTrustedMutationAcl `
                -Path $next `
                -Label "Precision Tools environment ancestor"
        }
        $current = $next
    }
    if (-not $current.Equals(
        $parent,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Precision Tools environment parent traversal was incomplete"
    }

    $acl = Get-Acl -LiteralPath $parent
    $runtime = [Security.Principal.SecurityIdentifier]::new(
        $script:PrecisionToolsRuntimeSidValue
    )
    $acl.SetAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            $runtime,
            [Security.AccessControl.FileSystemRights]::ReadAndExecute,
            [Security.AccessControl.AccessControlType]::Allow
        )
    )
    Set-Acl -LiteralPath $parent -AclObject $acl
    Assert-PrecisionToolsNoReparsePoints -Path $parent
    Assert-PrecisionToolsTrustedMutationAcl `
        -Path $parent `
        -Label "Precision Tools environment parent"

    $staging = Join-Path $parent ".environment-staging"
    [void](Assert-PrecisionToolsPathContained `
        -Path $staging `
        -Root $parent `
        -Label "Precision Tools environment staging directory")
    Set-PrecisionToolsProtectedStagingDirectoryAcl -Path $staging
    return $staging
}

function Set-PrecisionToolsProtectedFileAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Precision Tools protected environment file was not found"
    }
    Assert-PrecisionToolsNoReparsePoints -Path $Path
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $system = [Security.Principal.SecurityIdentifier]::new(
        $script:PrecisionToolsSystemSidValue
    )
    $administrators = [Security.Principal.SecurityIdentifier]::new(
        $script:PrecisionToolsAdministratorsSidValue
    )
    $runtime = [Security.Principal.SecurityIdentifier]::new(
        $script:PrecisionToolsRuntimeSidValue
    )
    $acl.SetOwner($administrators)
    foreach ($sid in @($system, $administrators)) {
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                [Security.AccessControl.FileSystemRights]::FullControl,
                $allow
            )
        )
    }
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            $runtime,
            [Security.AccessControl.FileSystemRights]::Read,
            $allow
        )
    )
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Read-PrecisionToolsEnvironmentValues {
    param([Parameter(Mandatory = $true)][string]$Path)

    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines(
        $Path,
        [Text.Encoding]::UTF8
    )) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        if (-not $trimmed.Contains("=")) {
            throw "Precision Tools EnvironmentFile contains a malformed entry"
        }
        $parts = $trimmed.Split("=", 2)
        $key = $parts[0].Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "Precision Tools EnvironmentFile contains an invalid key"
        }
        if ($values.ContainsKey($key)) {
            throw "Precision Tools EnvironmentFile contains a duplicate key"
        }
        $values[$key] = $parts[1].Trim().Trim('"').Trim("'")
    }
    return $values
}

function Assert-PrecisionToolsProductionEnvironmentValues {
    param([Parameter(Mandatory = $true)][hashtable]$Values)

    foreach ($key in $Values.Keys) {
        if ($key -notin $script:PrecisionToolsApplicationEnvironmentKeys) {
            throw "Precision Tools production EnvironmentFile contains an unsupported key"
        }
    }
    foreach ($key in $script:PrecisionToolsRequiredProductionEnvironmentKeys) {
        if (
            -not $Values.ContainsKey($key) -or
            [string]::IsNullOrWhiteSpace([string]$Values[$key])
        ) {
            throw "Precision Tools production EnvironmentFile is missing a required key"
        }
    }
    foreach ($secretKey in @(
        "SECRET_KEY",
        "ADMIN_SECRET_KEY",
        "QUOTE_HANDOFF_SIGNING_SECRET",
        "NEXTGEN_LEGACY_HANDOFF_SECRET"
    )) {
        if (([string]$Values[$secretKey]).Length -lt 32) {
            throw "Precision Tools production EnvironmentFile contains a short secret"
        }
    }
    foreach ($pythonKey in @("BACKEND_PYTHON", "OCC_PYTHON")) {
        if (-not [IO.Path]::IsPathRooted([string]$Values[$pythonKey])) {
            throw "Precision Tools production Python paths must be absolute"
        }
    }
    $fixedValues = @{
        NEXTGEN_API_BASE_URL = "http://127.0.0.1:5400/api/v2"
        NEXTGEN_COMPANY_CODE = "daiyujin"
        NEXTGEN_CUSTOMER_PORTAL_URL = "https://portal.daiyujin.dpdns.org"
        NEXTGEN_HANDOFF_STAGING_ROOT = "C:\daiyujin\daiyujinweb\backend\private\nextgen_handoff"
    }
    foreach ($entry in $fixedValues.GetEnumerator()) {
        if ([string]$Values[$entry.Key] -cne [string]$entry.Value) {
            throw "Precision Tools production EnvironmentFile changes a fixed endpoint"
        }
    }
    $fixedOptionalPaths = @{
        QUOTE_JOBS_DB_PATH = "C:\daiyujin\daiyujinweb\backend\data\quote_jobs.db"
        QUOTE_JOB_STORAGE_ROOT = "C:\daiyujin\daiyujinweb\backend\uploads\quote-jobs"
    }
    foreach ($entry in $fixedOptionalPaths.GetEnumerator()) {
        if (-not $Values.ContainsKey($entry.Key)) {
            continue
        }
        $configured = [string]$Values[$entry.Key]
        if (
            [string]::IsNullOrWhiteSpace($configured) -or
            -not [IO.Path]::IsPathRooted($configured) -or
            -not [IO.Path]::GetFullPath($configured).Equals(
                [IO.Path]::GetFullPath([string]$entry.Value),
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw "Precision Tools production EnvironmentFile changes a fixed quote runtime path"
        }
    }
    if ([string]$Values["QUOTE_ASYNC_ARCHIVES_ENABLED"] -cnotin @("0", "1")) {
        throw "QUOTE_ASYNC_ARCHIVES_ENABLED must be 0 or 1"
    }
    $concurrency = 0
    if (
        -not [int]::TryParse(
            [string]$Values["QUOTE_CAD_CONCURRENCY"],
            [ref]$concurrency
        ) -or
        $concurrency -lt 1 -or
        $concurrency -gt 4
    ) {
        throw "QUOTE_CAD_CONCURRENCY must be an integer from 1 through 4"
    }
    if ([string]::IsNullOrWhiteSpace([string]$Values["ALLOWED_ORIGINS"])) {
        throw "ALLOWED_ORIGINS must not be empty"
    }

    $emailEnabled = (
        $Values.ContainsKey("QUOTE_EMAIL_ENABLED") -and
        [string]$Values["QUOTE_EMAIL_ENABLED"] -match "^(?i:true|1|yes|on)$"
    )
    if (
        $emailEnabled -and
        (
            -not $Values.ContainsKey("SMTP_USERNAME") -or
            [string]::IsNullOrWhiteSpace([string]$Values["SMTP_USERNAME"]) -or
            -not $Values.ContainsKey("SMTP_PASSWORD") -or
            [string]::IsNullOrWhiteSpace([string]$Values["SMTP_PASSWORD"])
        )
    ) {
        throw "Enabled quote email requires SMTP credentials"
    }

    $r2Keys = @(
        "R2_ACCESS_KEY_ID",
        "R2_ACCOUNT_ID",
        "R2_BUCKET",
        "R2_ENDPOINT",
        "R2_ENDPOINT_URL",
        "R2_REGION",
        "R2_SECRET_ACCESS_KEY"
    )
    $r2Configured = @(
        $r2Keys | Where-Object {
            $Values.ContainsKey($_) -and
            -not [string]::IsNullOrWhiteSpace([string]$Values[$_])
        }
    ).Count -gt 0
    if ($r2Configured) {
        foreach ($key in @(
            "R2_ACCESS_KEY_ID",
            "R2_BUCKET",
            "R2_SECRET_ACCESS_KEY"
        )) {
            if (
                -not $Values.ContainsKey($key) -or
                [string]::IsNullOrWhiteSpace([string]$Values[$key])
            ) {
                throw "Partial R2 production configuration is not allowed"
            }
        }
        if (
            @("R2_ENDPOINT_URL", "R2_ENDPOINT", "R2_ACCOUNT_ID").Where({
                $Values.ContainsKey($_) -and
                -not [string]::IsNullOrWhiteSpace([string]$Values[$_])
            }).Count -eq 0
        ) {
            throw "R2 production configuration requires an endpoint source"
        }
    }
}

function Assert-PrecisionToolsProductionEnvironmentFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = Assert-PrecisionToolsFixedEnvironmentPath -Path $Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Precision Tools production EnvironmentFile was not found"
    }
    Assert-PrecisionToolsNoReparsePoints -Path $resolved
    $acl = Get-Acl -LiteralPath $resolved
    Assert-PrecisionToolsProtectedAccessRules `
        -Acl $acl `
        -RuntimeRequiredRights (
            [Security.AccessControl.FileSystemRights]::Read
        )
    $values = Read-PrecisionToolsEnvironmentValues -Path $resolved
    Assert-PrecisionToolsProductionEnvironmentValues -Values $values
    return $resolved
}

function Import-PrecisionToolsEnvironmentFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$Production,
        [switch]$AllowMissing,
        [ValidateSet("Application", "Api", "ExchangeRate")]
        [string]$Profile = "Application"
    )

    if ($Production) {
        $resolved = Assert-PrecisionToolsProductionEnvironmentFile -Path $Path
    }
    else {
        if (-not [IO.Path]::IsPathRooted($Path)) {
            $Path = [IO.Path]::GetFullPath($Path)
        }
        $resolved = [IO.Path]::GetFullPath($Path)
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            if ($AllowMissing) {
                return
            }
            throw "Precision Tools development EnvironmentFile was not found"
        }
        Assert-PrecisionToolsNoReparsePoints -Path $resolved
    }

    $values = Read-PrecisionToolsEnvironmentValues -Path $resolved
    if ($Production) {
        Assert-PrecisionToolsProductionEnvironmentValues -Values $values
        foreach ($key in $script:PrecisionToolsInheritedEnvironmentKeysToClear) {
            [Environment]::SetEnvironmentVariable($key, $null, "Process")
        }
    }
    $exportKeys = if ($Production -and $Profile -eq "ExchangeRate") {
        @("BACKEND_PYTHON")
    }
    else {
        @($values.Keys)
    }
    foreach ($key in $exportKeys) {
        if ($values.ContainsKey($key)) {
            [Environment]::SetEnvironmentVariable(
                $key,
                [string]$values[$key],
                "Process"
            )
        }
    }
    $env:PRECISION_TOOLS_ENVIRONMENT_FILE = $resolved
    $env:PRECISION_TOOLS_PRODUCTION = if ($Production) { "1" } else { "0" }
}

function Write-PrecisionToolsEnvironmentFileAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Lines,
        [switch]$RequireNew
    )

    $resolved = Assert-PrecisionToolsFixedEnvironmentPath -Path $Path
    $parent = Split-Path -Parent $resolved
    $staging = Initialize-PrecisionToolsEnvironmentLayout `
        -EnvironmentPath $resolved
    $destinationExists = Test-Path -LiteralPath $resolved -PathType Leaf
    if ($RequireNew -and $destinationExists) {
        throw "Precision Tools production EnvironmentFile already exists"
    }
    if ($destinationExists) {
        [void](Assert-PrecisionToolsProductionEnvironmentFile -Path $resolved)
    }
    foreach ($line in $Lines) {
        if ([string]$line -match "[\r\n]") {
            throw "Precision Tools EnvironmentFile values must be single-line"
        }
    }

    $temporaryPath = Join-Path $staging (
        ".production-env-{0}.tmp" -f [Guid]::NewGuid().ToString("N")
    )
    [void](Assert-PrecisionToolsPathContained `
        -Path $temporaryPath `
        -Root $staging `
        -Label "Precision Tools environment staging file")
    $stream = $null
    $writer = $null
    $publishedNewDestination = $false
    $completed = $false
    try {
        $stream = [IO.FileStream]::new(
            $temporaryPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::WriteThrough
        )
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null

        Set-PrecisionToolsProtectedStagingFileAcl -Path $temporaryPath
        $temporaryAcl = Get-Acl -LiteralPath $temporaryPath
        Assert-PrecisionToolsProtectedStagingAccessRules -Acl $temporaryAcl

        $stream = [IO.FileStream]::new(
            $temporaryPath,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::WriteThrough
        )
        $writer = [IO.StreamWriter]::new(
            $stream,
            [Text.UTF8Encoding]::new($false),
            4096,
            $true
        )
        foreach ($line in $Lines) {
            $writer.WriteLine([string]$line)
        }
        $writer.Flush()
        $stream.Flush($true)
        $writer.Dispose()
        $writer = $null
        $stream.Dispose()
        $stream = $null

        Set-PrecisionToolsProtectedFileAcl -Path $temporaryPath
        Assert-PrecisionToolsNoReparsePoints -Path $resolved
        if ($destinationExists) {
            [IO.File]::Replace($temporaryPath, $resolved, $null, $true)
        }
        else {
            [IO.File]::Move($temporaryPath, $resolved)
            $publishedNewDestination = $true
        }
        [void](Assert-PrecisionToolsProductionEnvironmentFile -Path $resolved)
        $completed = $true
    }
    finally {
        if ($writer) {
            $writer.Dispose()
        }
        if ($stream) {
            $stream.Dispose()
        }
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if (
            -not $completed -and
            $publishedNewDestination -and
            (Test-Path -LiteralPath $resolved -PathType Leaf)
        ) {
            [void](Assert-PrecisionToolsFixedEnvironmentPath -Path $resolved)
            Remove-Item -LiteralPath $resolved -Force
        }
    }
}

function Set-PrecisionToolsEnvironmentValues {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Values,
        [string[]]$OnlyIfMissing = @()
    )

    $resolved = Assert-PrecisionToolsProductionEnvironmentFile -Path $Path
    $lines = [System.Collections.Generic.List[string]]::new()
    $indexes = @{}
    foreach ($line in [IO.File]::ReadAllLines(
        $resolved,
        [Text.Encoding]::UTF8
    )) {
        $lines.Add($line)
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        if (-not $trimmed.Contains("=")) {
            throw "Precision Tools EnvironmentFile contains a malformed entry"
        }
        $key = $trimmed.Split("=", 2)[0].Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "Precision Tools EnvironmentFile contains an invalid key"
        }
        if ($indexes.ContainsKey($key)) {
            throw "Precision Tools EnvironmentFile contains a duplicate key"
        }
        $indexes[$key] = $lines.Count - 1
    }
    foreach ($key in @($Values.Keys | Sort-Object)) {
        $value = [string]$Values[$key]
        if (
            $key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or
            $value -match "[\r\n]"
        ) {
            throw "Precision Tools EnvironmentFile update is malformed"
        }
        if ($indexes.ContainsKey($key)) {
            if ($key -notin $OnlyIfMissing) {
                $lines[[int]$indexes[$key]] = "$key=$value"
            }
        }
        else {
            $lines.Add("$key=$value")
        }
    }
    Write-PrecisionToolsEnvironmentFileAtomic `
        -Path $resolved `
        -Lines $lines.ToArray()
}
